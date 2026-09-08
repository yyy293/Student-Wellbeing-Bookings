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

app.set("trust proxy",1);
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
  res.status(status).setHeader("Cache-Control","no-store").json(data);
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
  return{...row,status:normalizeStatus(row.status)};
}

function requireOperator(req,res,next){
  if(!req.session.operatorId){
    return send(res,401,{success:false,error:"Please sign in first."});
  }
  next();
}

function todayString(){
  const now=new Date();
  return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

function generateBookingCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code="MAC-";
  for(let i=0;i<6;i++)code+=chars[crypto.randomInt(chars.length)];
  return code;
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

app.get("/",(req,res)=>{
  res.sendFile(path.join(__dirname,"index.html"));
});

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
      message:"M.A.C server is running but the database connection failed.",
      database:false
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
        success:false,
        error:"Unknown operator action."
      });
    }

    const email=String(req.body?.email||"").trim().toLowerCase();
    const password=String(req.body?.password||"");

    if(!email||!password){
      return send(res,400,{
        success:false,
        error:"Please enter your email and password."
      });
    }

    const result=await pool.query(
      "SELECT id,email,password_hash FROM operators WHERE email=$1 LIMIT 1",
      [email]
    );

    if(result.rows.length!==1){
      return send(res,401,{
        success:false,
        error:"Invalid operator email or password."
      });
    }

    const operator=result.rows[0];

    const valid=await bcrypt.compare(
      password,
      operator.password_hash
    );

    if(!valid){
      return send(res,401,{
        success:false,
        error:"Invalid operator email or password."
      });
    }

    req.session.operatorId=String(operator.id);
    req.session.operatorEmail=operator.email;

    return send(res,200,{
      success:true,
      authorized:true,
      email:operator.email
    });
  }catch(error){
    console.error("Operator login error:",error);

    return send(res,500,{
      success:false,
      error:"Operator login failed."
    });
  }
});

app.get("/api/operator",async(req,res)=>{
  const action=String(req.query.action||"").trim().toLowerCase();

  try{
    if(action==="availability"){
      return send(res,200,await getAvailability());
    }

    if(action==="check"){
      if(!req.session.operatorId){
        return send(res,401,{
          success:false,
          authorized:false,
          error:"Please sign in first."
        });
      }

      return send(res,200,{
        success:true,
        authorized:true,
        email:req.session.operatorEmail||""
      });
    }

    if(action==="bookings"){
      if(!req.session.operatorId){
        return send(res,401,{
          success:false,
          error:"Please sign in first."
        });
      }

      return send(res,200,await getBookings());
    }

    return send(res,404,{
      success:false,
      error:"Unknown operator action."
    });
  }catch(error){
    console.error("Operator GET error:",error);

    return send(res,500,{
      success:false,
      error:"The operator request failed."
    });
  }
});

app.put("/api/operator",requireOperator,async(req,res)=>{
  const action=String(req.query.action||"").trim().toLowerCase();

  try{
    if(action==="availability"){
      const dayNumber=Number(
        req.body?.day_number??req.body?.dayNumber
      );

      const isClosed=
        req.body?.is_closed??
        req.body?.isClosed;

      if(!Number.isInteger(dayNumber)||dayNumber<0||dayNumber>6){
        return send(res,400,{
          success:false,
          error:"Invalid day number."
        });
      }

      const closed=
        isClosed===true||
        isClosed===1||
        String(isClosed).toLowerCase()==="true"||
        String(isClosed)==="1";

      const result=await pool.query(
        "UPDATE availability SET is_closed=$1 WHERE day_number=$2 RETURNING day_number,day_name,is_closed",
        [closed,dayNumber]
      );

      if(result.rows.length!==1){
        return send(res,404,{
          success:false,
          error:"Availability day was not found."
        });
      }

      return send(res,200,result.rows[0]);
    }

    if(action==="booking"||action==="status"){
      const requested=normalizeStatus(req.body?.status);

      const existing=await findBooking(
        req.body?.id,
        req.body?.booking_code
      );

      if(!existing){
        return send(res,404,{
          success:false,
          error:"Booking was not found."
        });
      }

      const current=normalizeStatus(existing.status);

      if(requested==="Approved"&&current==="Cancelled"){
        return send(res,400,{
          success:false,
          error:"A cancelled booking cannot be approved. Restore it first."
        });
      }

      if(requested==="Approved"){
        const conflict=await pool.query(
          "SELECT id FROM bookings WHERE booking_date=$1 AND booking_time=$2 AND status='Approved' AND id<>$3 LIMIT 1",
          [
            existing.booking_date,
            existing.booking_time,
            existing.id
          ]
        );

        if(conflict.rows.length){
          return send(res,409,{
            success:false,
            error:"Another approved booking already uses this time."
          });
        }
      }

      const updated=await pool.query(
        "UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
        [requested,existing.id]
      );

      if(updated.rows.length!==1){
        return send(res,500,{
          success:false,
          error:"The booking status could not be saved."
        });
      }

      return send(
        res,
        200,
        cleanBooking(updated.rows[0])
      );
    }

    if(action==="reschedule"){
      const booking=await findBooking(
        req.body?.id,
        req.body?.booking_code
      );

      if(!booking){
        return send(res,404,{
          success:false,
          error:"Booking was not found."
        });
      }

      const bookingDate=String(
        req.body?.booking_date??
        req.body?.bookingDate??
        ""
      ).trim();

      const bookingTime=String(
        req.body?.booking_time??
        req.body?.bookingTime??
        ""
      ).trim();

      if(!validDate(bookingDate)){
        return send(res,400,{
          success:false,
          error:"Invalid booking date."
        });
      }

      if(!allowedTimes.includes(bookingTime)){
        return send(res,400,{
          success:false,
          error:"Invalid booking time."
        });
      }

      const date=new Date(`${bookingDate}T12:00:00`);

      const availability=await pool.query(
        "SELECT is_closed FROM availability WHERE day_number=$1 LIMIT 1",
        [date.getDay()]
      );

      if(availability.rows.length!==1){
        return send(res,500,{
          success:false,
          error:"Could not read booking availability."
        });
      }

      if(availability.rows[0].is_closed){
        return send(res,400,{
          success:false,
          error:"Bookings are closed on this day."
        });
      }

      const conflict=await pool.query(
        "SELECT id FROM bookings WHERE booking_date=$1 AND booking_time=$2 AND status IN ('Pending','Approved') AND id<>$3 LIMIT 1",
        [
          bookingDate,
          bookingTime,
          booking.id
        ]
      );

      if(conflict.rows.length){
        return send(res,409,{
          success:false,
          error:"Another active booking already uses this date and time."
        });
      }

      const updated=await pool.query(
        "UPDATE bookings SET booking_date=$1,booking_time=$2,updated_at=NOW() WHERE id=$3 RETURNING *",
        [
          bookingDate,
          bookingTime,
          booking.id
        ]
      );

      return send(
        res,
        200,
        cleanBooking(updated.rows[0])
      );
    }

    return send(res,404,{
      success:false,
      error:"Unknown operator action."
    });
  }catch(error){
    console.error("Operator PUT error:",error);

    return send(res,500,{
      success:false,
      error:"The operator request failed."
    });
  }
});

app.post("/api/bookings",async(req,res)=>{
  try{
    const studentName=String(
      req.body?.student_name||""
    ).trim();

    const studentClass=String(
      req.body?.student_class||""
    ).trim();

    const sessionType=String(
      req.body?.session_type||""
    ).trim();

    const bookingDate=String(
      req.body?.booking_date||""
    ).trim();

    const bookingTime=String(
      req.body?.booking_time||""
    ).trim();

    const studentMessage=String(
      req.body?.student_message||""
    ).trim();

    if(
      !studentName||
      !studentClass||
      !sessionType||
      !bookingDate||
      !bookingTime
    ){
      return send(res,400,{
        success:false,
        error:"Please complete all required fields."
      });
    }

    if(studentName.length>100){
      return send(res,400,{
        success:false,
        error:"Name is too long."
      });
    }

    if(studentClass.length>50){
      return send(res,400,{
        success:false,
        error:"Class is too long."
      });
    }

    if(studentMessage.length>500){
      return send(res,400,{
        success:false,
        error:"Note is too long."
      });
    }

    if(!sessionTypes.includes(sessionType)){
      return send(res,400,{
        success:false,
        error:"Invalid session type."
      });
    }

    if(!validDate(bookingDate)){
      return send(res,400,{
        success:false,
        error:"Invalid booking date."
      });
    }

    if(bookingDate<todayString()){
      return send(res,400,{
        success:false,
        error:"You cannot book a date in the past."
      });
    }

    if(!allowedTimes.includes(bookingTime)){
      return send(res,400,{
        success:false,
        error:"Invalid booking time."
      });
    }

    const date=new Date(`${bookingDate}T12:00:00`);

    const availability=await pool.query(
      "SELECT is_closed FROM availability WHERE day_number=$1 LIMIT 1",
      [date.getDay()]
    );

    if(availability.rows.length!==1){
      return send(res,500,{
        success:false,
        error:"Could not read booking availability."
      });
    }

    if(availability.rows[0].is_closed){
      return send(res,400,{
        success:false,
        error:"Bookings are closed on this day."
      });
    }

    const conflict=await pool.query(
      "SELECT id FROM bookings WHERE booking_date=$1 AND booking_time=$2 AND status IN ('Pending','Approved') LIMIT 1",
      [
        bookingDate,
        bookingTime
      ]
    );

    if(conflict.rows.length){
      return send(res,409,{
        success:false,
        error:"That time has already been requested. Please choose another time."
      });
    }

    let created=null;

    for(let attempt=0;attempt<10&&!created;attempt++){
      const code=generateBookingCode();

      try{
        const result=await pool.query(
          "INSERT INTO bookings (booking_code,student_name,student_class,session_type,booking_date,booking_time,student_message,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending') RETURNING booking_code,session_type,booking_date,booking_time,status",
          [
            code,
            studentName,
            studentClass,
            sessionType,
            bookingDate,
            bookingTime,
            studentMessage||null
          ]
        );

        created=result.rows[0];
      }catch(error){
        if(error.code!=="23505"){
          throw error;
        }
      }
    }

    if(!created){
      return send(res,500,{
        success:false,
        error:"Could not create a unique booking code. Please try again."
      });
    }

    return send(
      res,
      201,
      cleanBooking(created)
    );
  }catch(error){
    console.error("Booking creation error:",error);

    return send(res,500,{
      success:false,
      error:"The booking could not be created."
    });
  }
});

app.get("/api/booking-status",async(req,res)=>{
  try{
    const code=String(
      req.query?.code||""
    ).trim().toUpperCase();

    if(!code){
      return send(res,400,{
        success:false,
        error:"Please enter your booking code."
      });
    }

    const result=await pool.query(
      "SELECT booking_code,session_type,booking_date,booking_time,status FROM bookings WHERE booking_code=$1 LIMIT 1",
      [code]
    );

    if(result.rows.length!==1){
      return send(res,404,{
        success:false,
        error:"Booking not found."
      });
    }

    return send(
      res,
      200,
      cleanBooking(result.rows[0])
    );
  }catch(error){
    console.error("Booking status error:",error);

    return send(res,500,{
      success:false,
      error:"Could not check the booking status."
    });
  }
});

app.post("/api/booking-status",async(req,res)=>{
  try{
    const code=String(
      req.body?.code||""
    ).trim().toUpperCase();

    const action=String(
      req.body?.action||""
    ).trim().toLowerCase();

    if(!code){
      return send(res,400,{
        success:false,
        error:"Please enter your booking code."
      });
    }

    if(action!=="cancel"){
      return send(res,400,{
        success:false,
        error:"Invalid booking action."
      });
    }

    const existing=await pool.query(
      "SELECT * FROM bookings WHERE booking_code=$1 LIMIT 1",
      [code]
    );

    if(existing.rows.length!==1){
      return send(res,404,{
        success:false,
        error:"Booking not found."
      });
    }

    const booking=existing.rows[0];
    const status=normalizeStatus(booking.status);

    if(status==="Cancelled"){
      return send(
        res,
        200,
        cleanBooking(booking)
      );
    }

    if(status==="Completed"){
      return send(res,400,{
        success:false,
        error:"Completed bookings cannot be cancelled."
      });
    }

    const updated=await pool.query(
      "UPDATE bookings SET status='Cancelled',updated_at=NOW() WHERE id=$1 RETURNING *",
      [booking.id]
    );

    return send(
      res,
      200,
      cleanBooking(updated.rows[0])
    );
  }catch(error){
    console.error("Booking cancellation error:",error);

    return send(res,500,{
      success:false,
      error:"The booking could not be cancelled."
    });
  }
});

app.use((req,res)=>{
  if(req.path.startsWith("/api/")){
    return send(res,404,{
      success:false,
      error:"API route not found."
    });
  }

  res.sendFile(path.join(__dirname,"index.html"));
});

app.use((error,req,res,next)=>{
  console.error(error);

  if(error.type==="entity.too.large"){
    return send(res,413,{
      success:false,
      error:"Request is too large."
    });
  }

  return send(res,500,{
    success:false,
    error:"Server error."
  });
});

(async()=>{
  try{
    await pool.query("SELECT 1");
    await seedOperator();

    app.listen(PORT,"0.0.0.0",()=>{
      console.log(`M.A.C server running on port ${PORT}`);
    });
  }catch(error){
    console.error("Startup error:",error);
    process.exit(1);
  }
})();
