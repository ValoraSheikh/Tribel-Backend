import express from 'express';
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan'
import dotenv from 'dotenv';

const app = express();
dotenv.config({ path: './.env'})

const port = process.env.PORT;

app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]
}))
app.use(express.json({ limit: "16kb"}))
app.use(express.urlencoded({ extended: true, limit: "16kb"}))
app.use(express.static("public"))
app.use(cookieParser())
app.use(helmet())
app.use(hpp())

if(process.env.NODE_ENV === "development"){
  app.use(morgan("dev"))
}

app.get('/', (_req, res) => {
  res.send('Hello, TypeScript Node Express!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
