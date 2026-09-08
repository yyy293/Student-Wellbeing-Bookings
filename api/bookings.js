const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;

const allowedSessions=["Wellbeing Talk","Project Session","General Support"];
const allowedTimes=["09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30"];

function send(res,status,data){
  res.status(status).setHeader("Content-Type","application/json").setHeader("Cache-Control","no-store, max-age=0").end(JSON.stringify(data));
}

function getConfig(){
  if(!SUPABASE_URL||!SUPABASE_SECRET_KEY)throw new Error("Supabase server configuration is missing.");
  if(/^sb_publishable_/i.test(SUPABASE_SECRET_KEY))throw new Error("The Supabase server key must be the Secret key.");
  return{url:SUPABASE_URL.replace(/\/$/,""),key:SUPABASE_SECRET_KEY};
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

function todayString(){
  const now=new Date();

  return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function generateBookingCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code="MAC-";

  for(let i=0;i<6;i++){
    code+=chars[Math.floor(Math.random()*chars.length)];
  }

  return code;
}

export default async function handler(req,res){
  if(req.method!=="POST"){
    return send(res,405,{error:"Method not allowed"});
  }

  try{
    const config=getConfig();
    const body=req.body||{};

    const studentName=String(body.student_name||"").trim();
    const studentClass=String(body.student_class||"").trim();
    const sessionType=String(body.session_type||"").trim();
    const bookingDate=String(body.booking_date||"").trim();
    const bookingTime=String(body.booking_time||"").trim();
    const studentMessage=String(body.student_message||"").trim();

    if(!studentName||!studentClass||!sessionType||!bookingDate||!bookingTime){
      return send(res,400,{error:"Please complete all required fields."});
    }

    if(studentName.length>100){
      return send(res,400,{error:"Name is too long."});
    }

    if(studentClass.length>50){
      return send(res,400,{error:"Class is too long."});
    }

    if(studentMessage.length>500){
      return send(res,400,{error:"Note is too long."});
    }

    if(!allowedSessions.includes(sessionType)){
      return send(res,400,{error:"Invalid session type."});
    }

    if(!allowedTimes.includes(bookingTime)){
      return send(res,400,{error:"Invalid booking time."});
    }

    if(!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)){
      return send(res,400,{error:"Invalid booking date."});
    }

    if(bookingDate<todayString()){
      return send(res,400,{error:"You cannot book a date in the past."});
    }

    const dateObject=new Date(`${bookingDate}T12:00:00`);

    if(Number.isNaN(dateObject.getTime())){
      return send(res,400,{error:"Invalid booking date."});
    }

    const availability=await db(
      config,
      `/rest/v1/availability?day_number=eq.${dateObject.getDay()}&select=is_closed&limit=1`
    );

    if(!Array.isArray(availability)||availability.length!==1){
      return send(res,500,{error:"Could not read booking availability."});
    }

    if(availability[0].is_closed===true){
      return send(res,400,{error:"Bookings are closed on this day."});
    }

    const existing=await db(
      config,
      `/rest/v1/bookings?booking_date=eq.${encodeURIComponent(bookingDate)}&booking_time=eq.${encodeURIComponent(bookingTime)}&status=in.(Pending,Approved)&select=id&limit=1`
    );

    if(!Array.isArray(existing)){
      return send(res,500,{error:"Could not check booking availability."});
    }

    if(existing.length){
      return send(res,409,{error:"That time has already been requested. Please choose another time."});
    }

    let bookingCode="";

    for(let attempt=0;attempt<10;attempt++){
      const candidate=generateBookingCode();

      try{
        const rows=await db(
          config,
          "/rest/v1/bookings?select=booking_code",
          {
            method:"POST",
            headers:{
              Prefer:"return=representation"
            },
            body:JSON.stringify({
              booking_code:candidate,
              student_name:studentName,
              student_class:studentClass,
              session_type:sessionType,
              booking_date:bookingDate,
              booking_time:bookingTime,
              student_message:studentMessage||null,
              status:"Pending"
            })
          }
        );

        if(!Array.isArray(rows)||rows.length!==1){
          throw new Error("The booking was created but could not be confirmed.");
        }

        bookingCode=rows[0].booking_code;
        break;
      }catch(error){
        if(error?.message?.includes("duplicate key")||error?.message?.includes("23505")){
          continue;
        }

        throw error;
      }
    }

    if(!bookingCode){
      return send(res,500,{error:"Could not create a unique booking code. Please try again."});
    }

    return send(res,201,{
      booking_code:bookingCode
    });
  }catch(error){
    return send(res,500,{
      error:error?.message||"Server error."
    });
  }
}