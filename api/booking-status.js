const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function getCode(req){
  const base=req.headers.host?`https://${req.headers.host}`:"http://localhost";
  const url=new URL(req.url||"/api/booking-status",base);

  return String(url.searchParams.get("code")||"").trim().toUpperCase();
}

export default async function handler(req,res){
  try{
    const config=getConfig();
    const body=req.body||{};
    const code=String(body.code||getCode(req)||"").trim().toUpperCase();

    if(!code){
      return send(res,400,{
        error:"Please enter your booking code."
      });
    }

    if(req.method==="GET"){
      const rows=await db(
        config,
        `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}&select=booking_code,status,session_type,booking_date,booking_time&limit=1`
      );

      if(!Array.isArray(rows)||rows.length!==1){
        return send(res,404,{error:"Booking not found."});
      }

      return send(res,200,rows[0]);
    }

    if(req.method==="POST"){
      const action=String(body.action||"").trim().toLowerCase();

      if(action!=="cancel"){
        return send(res,400,{error:"Invalid booking action."});
      }

      const current=await db(
        config,
        `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}&select=*&limit=1`
      );

      if(!Array.isArray(current)||current.length!==1){
        return send(res,404,{error:"Booking not found."});
      }

      const booking=current[0];
      const status=String(booking.status||"").trim().toLowerCase();

      if(status==="cancelled"){
        return send(res,200,{
          booking_code:code,
          status:"Cancelled",
          booking_date:booking.booking_date,
          booking_time:booking.booking_time,
          session_type:booking.session_type
        });
      }

      if(status==="completed"){
        return send(res,400,{
          error:"Completed bookings cannot be cancelled."
        });
      }

      const updated=await db(
        config,
        `/rest/v1/bookings?booking_code=eq.${encodeURIComponent(code)}`,
        {
          method:"PATCH",
          headers:{
            Prefer:"return=representation,count=exact"
          },
          body:JSON.stringify({
            status:"Cancelled"
          })
        }
      );

      if(!Array.isArray(updated)||updated.length!==1){
        return send(res,500,{
          error:"The booking could not be cancelled."
        });
      }

      return send(res,200,updated[0]);
    }

    return send(res,405,{error:"Method not allowed"});
  }catch(error){
    return send(res,500,{
      error:error?.message||"Server error."
    });
  }
}