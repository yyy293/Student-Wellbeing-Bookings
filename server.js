const express=require("express");
const path=require("path");
const {Pool}=require("pg");
require("dotenv").config();

const app=express();
const PORT=process.env.PORT||3000;

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:{rejectUnauthorized:false}
});

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/health",async(req,res)=>{
  try{
    const result=await pool.query("SELECT NOW()");
    res.json({
      success:true,
      message:"M.A.C server is running",
      database:true,
      time:result.rows[0].now
    });
  }catch(error){
    console.error(error);
    res.status(500).json({
      success:false,
      message:"M.A.C server is running but the database connection failed."
    });
  }
});

app.listen(PORT,()=>{
  console.log(`M.A.C server running on port ${PORT}`);
});