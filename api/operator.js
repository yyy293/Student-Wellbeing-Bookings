function send(res,status,data){
    res.status(status).json(data);
    }
    
    function getConfig(){
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
    url:url.replace(/\/$/,""),
    secret,
    publishable
    };
    }
    
    async function supabaseRequest(url,options={}){
    const response=await fetch(url,{
    method:options.method||"GET",
    headers:{
    apikey:options.apikey,
    Authorization:"Bearer "+options.apikey,
    "Content-Type":"application/json",
    Prefer:options.prefer||"return=representation"
    },
    body:options.body
    });
    
    const text=await response.text();
    
    let data=null;
    
    try{
    data=text?JSON.parse(text):null;
    }catch{
    data={error:text||"Supabase returned an invalid response"};
    }
    
    if(!response.ok){
    const message=
    data?.message||
    data?.error_description||
    data?.error||
    "Supabase request failed";
    
    throw new Error(message);
    }
    
    return data;
    }
    
    async function getOperator(req,config){
    
    const authorization=req.headers.authorization||"";
    
    if(!authorization.startsWith("Bearer ")){
    return {error:"No operator authorization token"};
    }
    
    const token=authorization.slice(7);
    
    const user=await supabaseRequest(
    config.url+"/auth/v1/user",
    {
    apikey:config.publishable,
    headers:{
    }
    }
    );
    
    if(!user){
    return {error:"Invalid operator login session"};
    }
    
    const operatorRows=await supabaseRequest(
    config.url+
    "/rest/v1/operator_users?select=user_id&user_id=eq."+
    encodeURIComponent(user.id),
    {
    apikey:config.secret
    }
    );
    
    if(!Array.isArray(operatorRows)||operatorRows.length===0){
    return {
    error:"This Supabase user is not an authorized operator"
    };
    }
    
    return {
    user,
    config
    };
    }
    
    module.exports=async function handler(req,res){
    
    try{
    
    const config=getConfig();
    
    if(req.method==="GET"){
    
    const action=req.query.action;
    
    if(action==="availability"){
    
    const data=await supabaseRequest(
    config.url+
    "/rest/v1/availability?select=day_number,day_name,is_closed&order=day_number",
    {
    apikey:config.secret
    }
    );
    
    return send(res,200,data||[]);
    
    }
    
    if(action==="check"||action==="bookings"){
    
    const authorization=req.headers.authorization||"";
    
    if(!authorization.startsWith("Bearer ")){
    return send(res,401,{
    error:"No operator authorization token"
    });
    }
    
    const token=authorization.slice(7);
    
    const userResponse=await fetch(
    config.url+"/auth/v1/user",
    {
    method:"GET",
    headers:{
    apikey:config.publishable,
    Authorization:"Bearer "+token
    }
    }
    );
    
    const userText=await userResponse.text();
    
    let user=null;
    
    try{
    user=userText?JSON.parse(userText):null;
    }catch{
    user=null;
    }
    
    if(!userResponse.ok||!user||!user.id){
    return send(res,401,{
    error:"Invalid operator login session"
    });
    }
    
    const operatorRows=await supabaseRequest(
    config.url+
    "/rest/v1/operator_users?select=user_id&user_id=eq."+
    encodeURIComponent(user.id),
    {
    apikey:config.secret
    }
    );
    
    if(!Array.isArray(operatorRows)||operatorRows.length===0){
    return send(res,403,{
    error:"This Supabase user is not an authorized operator"
    });
    }
    
    if(action==="check"){
    return send(res,200,{authorized:true});
    }
    
    const bookings=await supabaseRequest(
    config.url+
    "/rest/v1/bookings?select=id,booking_code,student_name,student_class,session_type,booking_date,booking_time,student_message,status,created_at&order=booking_date.asc&order=booking_time.asc",
    {
    apikey:config.secret
    }
    );
    
    return send(res,200,bookings||[]);
    
    }
    
    return send(res,400,{
    error:"Invalid action"
    });
    
    }
    
    if(req.method==="PUT"){
    
    const authorization=req.headers.authorization||"";
    
    if(!authorization.startsWith("Bearer ")){
    return send(res,401,{
    error:"No operator authorization token"
    });
    }
    
    const token=authorization.slice(7);
    
    const userResponse=await fetch(
    config.url+"/auth/v1/user",
    {
    method:"GET",
    headers:{
    apikey:config.publishable,
    Authorization:"Bearer "+token
    }
    }
    );
    
    const userText=await userResponse.text();
    
    let user=null;
    
    try{
    user=userText?JSON.parse(userText):null;
    }catch{
    user=null;
    }
    
    if(!userResponse.ok||!user||!user.id){
    return send(res,401,{
    error:"Invalid operator login session"
    });
    }
    
    const operatorRows=await supabaseRequest(
    config.url+
    "/rest/v1/operator_users?select=user_id&user_id=eq."+
    encodeURIComponent(user.id),
    {
    apikey:config.secret
    }
    );
    
    if(!Array.isArray(operatorRows)||operatorRows.length===0){
    return send(res,403,{
    error:"This Supabase user is not an authorized operator"
    });
    }
    
    const action=req.query.action;
    const body=req.body||{};
    
    if(action==="availability"){
    
    const dayNumber=Number(body.day_number);
    const isClosed=Boolean(body.is_closed);
    
    if(
    !Number.isInteger(dayNumber)||
    dayNumber<0||
    dayNumber>6
    ){
    return send(res,400,{
    error:"Invalid day."
    });
    }
    
    await supabaseRequest(
    config.url+
    "/rest/v1/availability?day_number=eq."+
    dayNumber,
    {
    method:"PATCH",
    apikey:config.secret,
    body:JSON.stringify({
    is_closed:isClosed
    })
    }
    );
    
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
    
    const bookings=await supabaseRequest(
    config.url+
    "/rest/v1/bookings?select=id,booking_date,booking_time&id=eq."+
    encodeURIComponent(id),
    {
    apikey:config.secret
    }
    );
    
    if(!Array.isArray(bookings)||bookings.length===0){
    return send(res,404,{
    error:"Booking not found."
    });
    }
    
    const booking=bookings[0];
    
    const conflicts=await supabaseRequest(
    config.url+
    "/rest/v1/bookings?select=id&booking_date=eq."+
    encodeURIComponent(booking.booking_date)+
    "&booking_time=eq."+
    encodeURIComponent(booking.booking_time)+
    "&status=eq.Approved&id=neq."+
    encodeURIComponent(id),
    {
    apikey:config.secret
    }
    );
    
    if(Array.isArray(conflicts)&&conflicts.length){
    return send(res,409,{
    error:"Another approved booking already uses this time."
    });
    }
    
    }
    
    await supabaseRequest(
    config.url+
    "/rest/v1/bookings?id=eq."+
    encodeURIComponent(id),
    {
    method:"PATCH",
    apikey:config.secret,
    body:JSON.stringify({
    status
    })
    }
    );
    
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