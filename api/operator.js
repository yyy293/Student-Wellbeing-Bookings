const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res,status,data){res.status(status).setHeader("Content-Type","application/json").setHeader("Cache-Control","no-store, max-age=0").end(JSON.stringify(data));}

function getConfig(){
  if(!SUPABASE_URL||!SUPABASE_SECRET_KEY)throw new Error("Supabase server configuration is missing.");
  if(/^sb_publishable_/i.test(SUPABASE_SECRET_KEY))throw new Error("SUPABASE_SECRET_KEY must be your Supabase Secret key, not the Publishable key.");
  return{url:SUPABASE_URL.replace(/\/$/,""),key:SUPABASE_SECRET_KEY};
}

function getToken(req){
  const value=req.headers.authorization||"";
  return value.startsWith("Bearer ")?value.slice(7):"";
}

async function db(config,path,options={}){
  const response=await fetch(`${config.url}${path}`,{
    ...options,
    headers:{
      apikey:config.key,
      Authorization:`Bearer ${config.key}`,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });

  const text=await response.text();
  let data=null;

  try{data=text?JSON.parse(text):null;}catch{}

  if(!response.ok){
    throw new Error(data?.message||data?.error_description||data?.error||text||`Supabase request failed (${response.status})`);
  }

  return data;
}

async function verifyOperator(req,config){
  const token=getToken(req);

  if(!token)return{ok:false,status:401,error:"Please sign in first."};

  const response=await fetch(`${config.url}/auth/v1/user`,{
    headers:{
      apikey:config.key,
      Authorization:`Bearer ${token}`
    }
  });

  const user=await response.json().catch(()=>null);

  if(!response.ok||!user?.id){
    return{ok:false,status:401,error:"Invalid or expired operator session."};
  }

  const allowed=process.env.OPERATOR_EMAILS||process.env.OPERATOR_EMAIL||"";

  if(allowed.trim()){
    const emails=allowed.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    const email=String(user.email||"").trim().toLowerCase();

    if(!emails.includes(email)){
      return{ok:false,status:403,error:"This account is not an authorised operator."};
    }
  }

  return{ok:true,user};
}

async function getAvailability(config){
  const rows=await db(config,"/rest/v1/availability?select=*&order=day_number.asc");
  return Array.isArray(rows)?rows:[];
}

async function updateAvailability(config,dayNumber,isClosed){
  const n=Number(dayNumber);

  if(!Number.isInteger(n)||n<0||n>6){
    throw new Error("Invalid day number.");
  }

  const closed=isClosed===true||isClosed==="true"||isClosed===1||isClosed==="1";

  const rows=await db(
    config,
    `/rest/v1/availability?day_number=eq.${encodeURIComponent(n)}&select=*`,
    {
      method:"PATCH",
      headers:{
        Prefer:"return=representation,count=exact"
      },
      body:JSON.stringify({is_closed:closed})
    }
  );

  if(!Array.isArray(rows)||rows.length!==1){
    throw new Error("Availability day was not updated.");
  }

  return rows[0];
}

async function getBookings(config){
  const rows=await db(config,"/rest/v1/bookings?select=*&order=created_at.desc");
  return Array.isArray(rows)?rows:[];
}

async function findBooking(config,id,bookingCode){
  const code=String(bookingCode||"").trim();
  const cleanId=String(id||"").trim();

  if(code){
    const rows=await db(
      config,
      `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}&select=*`
    );

    if(Array.isArray(rows)&&rows.length===1){
      return rows[0];
    }
  }

  if(cleanId){
    const rows=await db(
      config,
      `/rest/v1/bookings?id=eq.${encodeURIComponent(cleanId)}&select=*`
    );

    if(Array.isArray(rows)&&rows.length===1){
      return rows[0];
    }
  }

  return null;
}

async function updateBooking(config,id,bookingCode,status){
  const allowed=["Pending","Approved","Cancelled","Completed"];
  const requested=String(status||"").trim().toLowerCase();
  const cleanStatus=allowed.find(x=>x.toLowerCase()===requested);

  if(!cleanStatus){
    throw new Error("Invalid booking status.");
  }

  const existing=await findBooking(config,id,bookingCode);

  if(!existing){
    throw new Error("Booking was not found.");
  }

  const current=String(existing.status||"").trim().toLowerCase();

  if(cleanStatus==="Approved"&&current==="cancelled"){
    throw new Error("A cancelled booking cannot be approved. Restore it first.");
  }

  if(cleanStatus==="Approved"&&existing.booking_date&&existing.booking_time){
    const conflicts=await db(
      config,
      `/rest/v1/bookings?booking_date=eq.${encodeURIComponent(String(existing.booking_date))}&booking_time=eq.${encodeURIComponent(String(existing.booking_time))}&status=eq.Approved&select=id,booking_code`
    );

    const conflict=Array.isArray(conflicts)&&conflicts.find(
      x=>String(x.id)!==String(existing.id)
    );

    if(conflict){
      throw new Error("Another approved booking already uses this time.");
    }
  }

  const code=String(existing.booking_code||"").trim();

  if(!code){
    throw new Error("This booking has no booking code.");
  }

  const updatedRows=await db(
    config,
    `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}`,
    {
      method:"PATCH",
      headers:{
        Prefer:"return=representation,count=exact"
      },
      body:JSON.stringify({
        status:cleanStatus
      })
    }
  );

  if(!Array.isArray(updatedRows)||updatedRows.length!==1){
    throw new Error("Supabase did not update this booking. Check the Supabase Secret key and the booking code.");
  }

  const verifiedRows=await db(
    config,
    `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}&select=*`
  );

  if(!Array.isArray(verifiedRows)||verifiedRows.length!==1){
    throw new Error("The booking could not be verified after the update.");
  }

  const saved=verifiedRows[0];

  if(String(saved.status||"").trim().toLowerCase()!==cleanStatus.toLowerCase()){
    throw new Error(`Supabase saved the request but the booking still reads "${saved.status}".`);
  }

  return saved;
}

async function rescheduleBooking(config,id,bookingCode,bookingDate,bookingTime){
  const date=String(bookingDate||"").trim();
  const time=String(bookingTime||"").trim();

  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    throw new Error("Invalid booking date.");
  }

  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){
    throw new Error("Invalid booking time.");
  }

  const existing=await findBooking(config,id,bookingCode);

  if(!existing){
    throw new Error("Booking was not found.");
  }

  const d=new Date(`${date}T12:00:00`);

  if(Number.isNaN(d.getTime())){
    throw new Error("Invalid booking date.");
  }

  const availability=await getAvailability(config);
  const day=availability.find(x=>Number(x.day_number)===d.getDay());

  if(day?.is_closed){
    throw new Error("Bookings are closed on this day.");
  }

  if(String(existing.status||"").trim().toLowerCase()==="approved"){
    const conflicts=await db(
      config,
      `/rest/v1/bookings?booking_date=eq.${encodeURIComponent(date)}&booking_time=eq.${encodeURIComponent(time)}&status=eq.Approved&select=id,booking_code`
    );

    const conflict=Array.isArray(conflicts)&&conflicts.find(
      x=>String(x.id)!==String(existing.id)
    );

    if(conflict){
      throw new Error("Another approved booking already uses that date and time.");
    }
  }

  const code=String(existing.booking_code||"").trim();

  const rows=await db(
    config,
    `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}`,
    {
      method:"PATCH",
      headers:{
        Prefer:"return=representation,count=exact"
      },
      body:JSON.stringify({
        booking_date:date,
        booking_time:time
      })
    }
  );

  if(!Array.isArray(rows)||rows.length!==1){
    throw new Error("The booking date/time could not be saved.");
  }

  return rows[0];
}

export default async function handler(req,res){
  try{
    const config=getConfig();
    const base=req.headers.host?`https://${req.headers.host}`:"http://localhost";
    const url=new URL(req.url||"/api/operator",base);
    const action=url.searchParams.get("action")||"";

    if(req.method==="GET"&&action==="availability"){
      return send(res,200,{
        success:true,
        availability:await getAvailability(config)
      });
    }

    const auth=await verifyOperator(req,config);

    if(!auth.ok){
      return send(res,auth.status,{
        success:false,
        error:auth.error
      });
    }

    if(req.method==="GET"&&action==="check"){
      return send(res,200,{
        success:true,
        authorized:true,
        user:auth.user
      });
    }

    if(req.method==="GET"&&action==="bookings"){
      return send(res,200,{
        success:true,
        bookings:await getBookings(config)
      });
    }

    if(req.method==="PUT"&&(action==="booking"||action==="status")){
      const body=req.body||{};
      const booking=await updateBooking(
        config,
        body.id,
        body.booking_code,
        body.status
      );

      return send(res,200,{
        success:true,
        booking
      });
    }

    if(req.method==="PUT"&&action==="reschedule"){
      const body=req.body||{};
      const booking=await rescheduleBooking(
        config,
        body.id,
        body.booking_code,
        body.bookingDate??body.booking_date,
        body.bookingTime??body.booking_time
      );

      return send(res,200,{
        success:true,
        booking
      });
    }

    if(req.method==="PUT"&&action==="availability"){
      const body=req.body||{};
      const availability=await updateAvailability(
        config,
        body.dayNumber??body.day_number,
        body.isClosed??body.is_closed
      );

      return send(res,200,{
        success:true,
        availability
      });
    }

    return send(res,404,{
      success:false,
      error:"Unknown operator action."
    });
  }catch(error){
    console.error("Operator API error:",error);
    return send(res,500,{
      success:false,
      error:error?.message||"Server error."
    });
  }
}