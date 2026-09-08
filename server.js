const express=require("express");
const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcrypt");
const session=require("express-session");
const {Pool}=require("pg");
require("dotenv").config();

const app=express();
const PORT=process.env.PORT||3000;

if(!process.env.DATABASE_URL){
  throw new Error("DATABASE_URL is missing.");
}

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:{rejectUnauthorized:false}
});

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true,limit:"1mb"}));

app.use(session({
  name:"mac_operator_session",
  secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString("hex"),
  resave:false,
  saveUninitialized:false,
  cookie:{
    httpOnly:true,
    sameSite:"lax",
    secure:process.env.NODE_ENV==="production",
    maxAge:1000*60*60*8
  }
}));

app.use(express.static(__dirname));

function send(res,status,data){
  res.status(status)
    .setHeader("Content-Type","application/json")
    .setHeader("Cache-Control","no-store")
    .json(data);
}

function normalizeStatus(value){
  const text=String(value||"Pending").trim().toLowerCase();

  if(text==="approved")return"Approved";
  if(text==="cancelled"||text==="canceled")return"Cancelled";
  if(text==="completed")return"Completed";

  return"Pending";
}

function cleanBooking(row){
  if(!row)return null;

  return{
    ...row,
    status:normalizeStatus(row.status)
  };
}

function requireOperator(req,res,next){
  if(!req.session.operatorId){
    return send(res,401,{error:"Please sign in first."});
  }

  next();
}

const sessionTypes=[
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

function generateBookingCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code="MAC-";

  for(let i=0;i<6;i++){
    code+=chars[crypto.randomInt(chars.length)];
  }

  return code;
}

function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;

  const date=new Date(`${value}T12:00:00`);

  return !Number.isNaN(date.getTime())&&
    date.toISOString().slice(0,10)===value;
}

function todayString(){
  const now=new Date();

  return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

async function seedOperator(){
  const email=String(process.env.OPERATOR_EMAIL||"").trim().toLowerCase();
  const password=String(process.env.OPERATOR_PASSWORD||"");

  if(!email||!password)return;

  const count=await pool.query(
    "SELECT COUNT(*)::int AS count FROM operators"
  );

  if(Number(count.rows[0].count)>0)return;

  const passwordHash=await bcrypt.hash(password,12);

  await pool.query(
    "INSERT INTO operators (email,password_hash) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING",
    [email,passwordHash]
  );
}

async function getAvailability(){
  const result=await pool.query(
    "SELECT day_number,day_name,is_closed FROM availability ORDER BY day_number ASC"
  );

  return result.rows;
}

async function getBookings(){
  const result=await pool.query(
    "SELECT id,booking_code,student_name,student_class,session_type,booking_date,booking_time,student_message,status,created_at,updated_at FROM bookings ORDER BY created_at DESC"
  );

  return result.rows.map(cleanBooking);
}

async function findBooking(id,bookingCode){
  const code=String(bookingCode||"").trim().toUpperCase();
  const cleanId=String(id||"").trim();

  if(code){
    const result=await pool.query(
      "SELECT * FROM bookings WHERE booking_code=$1 LIMIT 1",
      [code]
    );

    if(result.rows.length===1)return result.rows[0];
  }

  if(cleanId&&/^\d+$/.test(cleanId)){
    const result=await pool.query(
      "SELECT * FROM bookings WHERE id=$1 LIMIT 1",
      [cleanId]
    );

    if(result.rows.length===1)return result.rows[0];
  }

  return null;
}

app.get("/api/health",async(req,res)=>{
  try{
    const result=await pool.query("SELECT NOW() AS now");

    return send(res,200,{
      success:true,
      message:"M.A.C server is running",
      database:true,
      time:result.rows[0].now
    });
  }catch(error){
    console.error(error);

    return send(res,500,{
      success:false,
      message:"M.A.C server is running but the database connection failed."
    });
  }
});

app.post("/api/operator",async(req,res)=>{
  const action=String(req.query.action||"").trim().toLowerCase();

  try{
    if(action==="logout"){
      req.session.destroy(()=>{
        send(res,200,{success:true});
      });

      return;
    }

    if(action!=="login"){
      return send(res,404,{
        error:"Unknown operator action."
      });
    }

    const email=String(req.body?.email||"").trim().toLowerCase();
    const password=String(req.body?.password||"");

    if(!email||!password){
      return send(res,400,{
        error:"Please enter your email and password."
      });
    }

   
