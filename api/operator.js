function getConfig(){
  const url=process.env.SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if(!url){
  throw new Error("SUPABASE_URL is missing in Vercel.");
  }
  
  if(!secret){
  throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.");
  }
  
  return{
  url:url.replace(/\/$/,""),
  secret
  };
  }
  
  async function supabaseFetch(config,path,options={}){
  const response=await fetch(
  config.url+path,
  {
  ...options,
  headers:{
  apikey:config.secret,
  Authorization:"Bearer "+config.secret,
  ...(options.headers||{})
  }
  }
  );
  
  const text=await response.text();
  
  let data=null;
  
  try{
  data=text?JSON.parse(text):null;
  }catch(error){
  data=null;
  }
  
  if(!response.ok){
  throw new Error(
  data&&data.message
  ?data.message
  :data&&data.error_description
  ?data.error_description
  :data&&data.error
  ?data.error
  :"Supabase request failed with HTTP "+response.status
  );
  }
  
  return data;
  }
  
  async function verifySession(config,req){
  const authorization=req.headers.authorization||"";
  
  if(!authorization.startsWith("Bearer ")){
  throw new Error("Invalid operator login session. Please sign in again.");
  }
  
  const token=authorization.substring(7).trim();
  
  if(!token){
  throw new Error("Invalid operator login session. Please sign in again.");
  }
  
  const response=await fetch(
  config.url+"/auth/v1/user",
  {
  method:"GET",
  headers:{
  apikey:config.secret,
  Authorization:"Bearer "+token
  }
  }
  );
  
  const text=await response.text();
  
  let user=null;
  
  try{
  user=text?JSON.parse(text):null;
  }catch(error){
  user=null;
  }
  
  if(!response.ok||!user||!user.id){
  throw new Error("Invalid operator login session. Please sign in again.");
  }
  
  return user;
  }
  
  async function getAvailability(config){
  return await supabaseFetch(
  config,
  "/rest/v1/availability?select=day_number,day_name,is_closed&order=day_number.asc"
  );
  }
  
  async function getBookings(config){
  return await supabaseFetch(
  config,
  "/rest/v1/bookings?select=*&order=created_at.desc"
  );
  }
  
  async function updateBooking(config,id,status){
  return await supabaseFetch(
  config,
  "/rest/v1/bookings?id=eq."+encodeURIComponent(id),
  {
  method:"PATCH",
  headers:{
  "Content-Type":"application/json",
  Prefer:"return=representation"
  },
  body:JSON.stringify({
  status
  })
  }
  );
  }
  
  async function updateAvailability(config,dayNumber,isClosed){
  return await supabaseFetch(
  config,
  "/rest/v1/availability?day_number=eq."+encodeURIComponent(dayNumber),
  {
  method:"PATCH",
  headers:{
  "Content-Type":"application/json",
  Prefer:"return=representation"
  },
  body:JSON.stringify({
  is_closed:isClosed
  })
  }
  );
  }
  
  export default async function handler(req,res){
  try{
  const config=getConfig();
  
  const method=req.method||"GET";
  
  const action=new URL(
  req.url,
  "http://localhost"
  ).searchParams.get("action");
  
  if(method==="GET"&&action==="availability"){
  const availability=await getAvailability(config);
  return res.status(200).json(availability);
  }
  
  if(
  action==="check"||
  action==="bookings"||
  action==="booking"||
  action==="status"||
  action==="availability"
  ){
  await verifySession(config,req);
  }
  
  if(method==="GET"&&action==="check"){
  const user=await verifySession(config,req);
  
  return res.status(200).json({
  authorized:true,
  user:{
  id:user.id,
  email:user.email||""
  }
  });
  }
  
  if(method==="GET"&&action==="bookings"){
  const bookings=await getBookings(config);
  return res.status(200).json(bookings);
  }
  
  if(
  method==="PUT"&&
  (action==="booking"||action==="status")
  ){
  const body=
  typeof req.body==="string"
  ?JSON.parse(req.body)
  :req.body||{};
  
  if(!body.id||!body.status){
  return res.status(400).json({
  error:"Booking id and status are required."
  });
  }
  
  if(
  !["Pending","Approved","Cancelled"].includes(
  body.status
  )
  ){
  return res.status(400).json({
  error:"Invalid booking status."
  });
  }
  
  const updated=await updateBooking(
  config,
  body.id,
  body.status
  );
  
  return res.status(200).json(updated);
  }
  
  if(
  method==="PUT"&&
  action==="availability"
  ){
  const body=
  typeof req.body==="string"
  ?JSON.parse(req.body)
  :req.body||{};
  
  if(
  body.day_number===undefined||
  body.is_closed===undefined
  ){
  return res.status(400).json({
  error:"Day number and closed state are required."
  });
  }
  
  const updated=await updateAvailability(
  config,
  body.day_number,
  Boolean(body.is_closed)
  );
  
  return res.status(200).json(updated);
  }
  
  return res.status(400).json({
  error:"Invalid operator request."
  });
  
  }catch(error){
  return res.status(500).json({
  error:error.message||"Server error."
  });
  }
  }