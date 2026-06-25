import { createRazorpayOrder, verifyRazorpayPayment } from "../controller/razorpay.controller.ts";
import { app } from "../app.ts";
import { requiresAuth } from "express-openid-connect";


app.get('/razorpay',requiresAuth(), createRazorpayOrder);
app.post('/verify', requiresAuth(), verifyRazorpayPayment);