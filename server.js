const express=require("express");
const path=require("path");
require("dotenv").config();

const app=express();
const PORT=process.env.PORT||3000;

app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.use(express.static(path.join(__dirname,"public")));

app.get("/api/health",(req,res)=>{
  res.json({
    success:true,
    message:"M.A.C server is running"
  });
});

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,()=>{
  console.log(`M.A.C server running on port ${PORT}`);
});