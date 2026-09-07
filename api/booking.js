const { createClient } = require("@supabase/supabase-js");

const supabase=createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const allowedSessions=[
"Wellbeing Talk",
"Project Session",
"General Support"
];

const allowedTimes=[
"09:30",
"10:00",
"10:30",
"11:00",
"11:30",
"12:00",
"12:30",
"13:00",
"13:30",
"14:00",
"14:30"
];

function send(res,status,data){
res.status(status).json(data);
}

function generateBookingCode(){

const characters=
"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let result="MAC-";

for(let i=0;i<10;i++){
result+=characters[
Math.floor(
Math.random()*characters.length
)
];
}

return result;
}

function getToday(){

const date=new Date();

return date.getFullYear()+"-"+
String(date.getMonth()+1).padStart(2,"0")+"-"+
String(date.getDate()).padStart(2,"0");
}

module.exports=async function handler(req,res){

if(req.method!=="POST"){

return send(res,405,{
error:"Method not allowed"
});

}

try{

if(!process.env.SUPABASE_URL){

return send(res,500,{
error:"Vercel is missing SUPABASE_URL"
});

}

if(!process.env.SUPABASE_SERVICE_ROLE_KEY){

return send(res,500,{
error:
"Vercel is missing SUPABASE_SERVICE_ROLE_KEY"
});

}

const body=req.body||{};

const studentName=
String(body.student_name||"").trim();

const studentClass=
String(body.student_class||"").trim();

const sessionType=
String(body.session_type||"").trim();

const bookingDate=
String(body.booking_date||"").trim();

const bookingTime=
String(body.booking_time||"").trim();

const studentMessage=
String(body.student_message||"").trim();

if(
!studentName||
!studentClass||
!sessionType||
!bookingDate||
!bookingTime
){

return send(res,400,{
error:
"Please complete all required fields."
});

}

if(studentName.length>100){

return send(res,400,{
error:"Name is too long."
});

}

if(studentClass.length>50){

return send(res,400,{
error:"Class is too long."
});

}

if(studentMessage.length>500){

return send(res,400,{
error:"Note is too long."
});

}

if(!allowedSessions.includes(sessionType)){

return send(res,400,{
error:"Invalid session type."
});

}

if(!allowedTimes.includes(bookingTime)){

return send(res,400,{
error:"Invalid booking time."
});

}

if(!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)){

return send(res,400,{
error:"Invalid booking date."
});

}

if(bookingDate<getToday()){

return send(res,400,{
error:"You cannot book a date in the past."
});

}

const dateObject=
new Date(bookingDate+"T12:00:00");

if(Number.isNaN(dateObject.getTime())){

return send(res,400,{
error:"Invalid booking date."
});

}

const dayNumber=dateObject.getDay();

const availabilityResult=
await supabase
.from("availability")
.select("is_closed")
.eq("day_number",dayNumber)
.single();

if(availabilityResult.error){

return send(res,500,{
error:
"Supabase availability error: "+
availabilityResult.error.message
});

}

if(availabilityResult.data.is_closed){

return send(res,400,{
error:"Bookings are closed on this day."
});

}

const existing=
await supabase
.from("bookings")
.select("id")
.eq("booking_date",bookingDate)
.eq("booking_time",bookingTime)
.in("status",["Pending","Approved"])
.limit(1);

if(existing.error){

return send(res,500,{
error:
"Supabase booking check error: "+
existing.error.message
});

}

if(existing.data&&existing.data.length){

return send(res,409,{
error:
"That time has already been requested. Please choose another time."
});

}

let bookingCode="";
let inserted=null;

for(let attempt=0;attempt<5;attempt++){

bookingCode=generateBookingCode();

const result=
await supabase
.from("bookings")
.insert({

booking_code:bookingCode,

student_name:studentName,

student_class:studentClass,

session_type:sessionType,

booking_date:bookingDate,

booking_time:bookingTime,

student_message:
studentMessage||null,

status:"Pending"

})
.select("booking_code")
.single();

if(!result.error){

inserted=result.data;
break;

}

if(result.error.code!=="23505"){

return send(res,500,{
error:
"Supabase booking error: "+
result.error.message
});

}

}

if(!inserted){

return send(res,500,{
error:
"Could not create a unique booking code. Please try again."
});

}

return send(res,201,{
booking_code:inserted.booking_code
});

}catch(error){

return send(res,500,{
error:
"Server error: "+
(error.message||"Unknown error")
});

}

};