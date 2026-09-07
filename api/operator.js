const { createClient } = require("@supabase/supabase-js");

function send(res,status,data){
res.status(status).json(data);
}

function getClients(){
const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishable=process.env.SUPABASE_ANON_KEY;

if(!url){
throw new Error("Vercel is missing SUPABASE_URL");
}

if(!secret){
throw new Error("Vercel is missing SUPABASE_SERVICE_ROLE_KEY");
}

if(!publishable){
throw new Error("Vercel is missing SUPABASE_ANON_KEY");
}

return {
admin:createClient(url,secret),
auth:createClient(url,publishable)
};
}

async function getOperator(req){

const authorization=req.headers.authorization||"";

if(!authorization.startsWith("Bearer ")){
return {
error:"No operator authorization token"
};
}

const token=authorization.slice(7);
const clients=getClients();

const {data:userData,error:userError}=await clients.auth.auth.getUser(token);

if(userError||!userData.user){
return {
error:"Invalid operator login session"
};
}

const {data:operator,error:operatorError}=await clients.admin
.from("operator_users")
.select("user_id")
.eq("user_id",userData.user.id)
.maybeSingle();

if(operatorError){
return {
error:"Operator database error: "+operatorError.message
};
}

if(!operator){
return {
error:"This Supabase user is not an authorized operator"
};
}

return {
user:userData.user,
admin:clients.admin
};
}

module.exports=async function handler(req,res){

try{

const clients=getClients();

if(req.method==="GET"){

const action=req.query.action;

if(action==="availability"){

const {data,error}=await clients.admin
.from("availability")
.select("day_number, day_name, is_closed")
.order("day_number");

if(error){
return send(res,500,{
error:"Supabase availability error: "+error.message
});
}

return send(res,200,data||[]);
}

if(action==="check"||action==="bookings"){

const operator=await getOperator(req);

if(operator.error){
return send(res,401,{
error:operator.error
});
}

if(action==="check"){
return send(res,200,{
authorized:true
});
}

const {data,error}=await operator.admin
.from("bookings")
.select(
"id, booking_code, student_name, student_class, session_type, booking_date, booking_time, student_message, status, created_at"
)
.order("booking_date",{ascending:true})
.order("booking_time",{ascending:true});

if(error){
return send(res,500,{
error:"Supabase bookings error: "+error.message
});
}

return send(res,200,data||[]);
}

return send(res,400,{
error:"Invalid action"
});
}

if(req.method==="PUT"){

const operator=await getOperator(req);

if(operator.error){
return send(res,401,{
error:operator.error
});
}

const action=req.query.action;
const body=req.body||{};

if(action==="availability"){

const dayNumber=Number(body.day_number);
const isClosed=Boolean(body.is_closed);

if(!Number.isInteger(dayNumber)||dayNumber<0||dayNumber>6){
return send(res,400,{
error:"Invalid day."
});
}

const {error}=await operator.admin
.from("availability")
.update({
is_closed:isClosed
})
.eq("day_number",dayNumber);

if(error){
return send(res,500,{
error:"Availability update error: "+error.message
});
}

return send(res,200,{
success:true
});
}

if(action==="status"){

const id=String(body.id||"");
const status=String(body.status||"");

if(!id){
return send(res,400,{
error:"Missing booking ID."
});
}

if(!["Approved","Cancelled"].includes(status)){
return send(res,400,{
error:"Invalid booking status."
});
}

if(status==="Approved"){

const {data:booking,error:bookingError}=await operator.admin
.from("bookings")
.select("booking_date, booking_time")
.eq("id",id)
.single();

if(bookingError){
return send(res,500,{
error:"Booking lookup error: "+bookingError.message
});
}

const {data:conflict,error:conflictError}=await operator.admin
.from("bookings")
.select("id")
.eq("booking_date",booking.booking_date)
.eq("booking_time",booking.booking_time)
.eq("status","Approved")
.neq("id",id)
.limit(1);

if(conflictError){
return send(res,500,{
error:"Conflict check error: "+conflictError.message
});
}

if(conflict&&conflict.length){
return send(res,409,{
error:"Another approved booking already uses this time."
});
}
}

const {error}=await operator.admin
.from("bookings")
.update({
status
})
.eq("id",id);

if(error){
return send(res,500,{
error:"Booking update error: "+error.message
});
}

return send(res,200,{
success:true
});
}

return send(res,400,{
error:"Invalid action"
});
}

return send(res,405,{
error:"Method not allowed"
});

}catch(error){

return send(res,500,{
error:"Server error: "+(error.message||"Unknown error")
});

}
};