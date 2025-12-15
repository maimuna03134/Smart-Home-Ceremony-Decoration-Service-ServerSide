const express = require("express");
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require('./homeDecorationServiceAdminSDK.json');
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.imnpg23.mongodb.net/?appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("decor-service");
    const serviceCollection = db.collection("services");

      app.get("/services", async (req, res) => {
        const result = await serviceCollection.find().toArray();
        res.send(result);
      });
       app.get("/services/:id", async (req, res) => {
         const id = req.params.id;
         const result = await serviceCollection.findOne({
           _id: new ObjectId(id),
         });
         res.send(result);
       });
  
    app.post('/services', async (req, res) => {
      const newService = req.body;
      const result = await serviceCollection.insertOne(newService);
      res.send(result)
    })

    // payment related APIs
app.post("/create-checkout-session", async (req, res) => {
  const paymentInfo = req.body;
  console.log(paymentInfo);
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "BDT",
          product_data: {
            name: paymentInfo?.name,
            description: paymentInfo?.description,
            images: [paymentInfo.image],
          },
          unit_amount: paymentInfo?.price * 100,
        },
        quantity: paymentInfo?.quantity,
      },
    ],
    customer_email: paymentInfo?.customer?.email,
    mode: "payment",
    metadata: {
      plantId: paymentInfo?.serviceId,
      customer: paymentInfo?.customer.email,
    },
    success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/plant/${paymentInfo?.serviceId}`,
  });
  res.send({ url: session.url });
});

app.post("/payment-success", async (req, res) => {
  const { sessionId } = req.body;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const service = await serviceCollection.findOne({
    _id: new ObjectId(session.metadata.serviceId),
  });
  const booking = await bookingsCollection.findOne({
    transactionId: session.payment_intent,
  });

  if (session.status === "complete" && service && !booking) {
    // save order data in db
    const bookingInfo = {
      serviceId: session.metadata.serviceId,
      transactionId: session.payment_intent,
      customer: session.metadata.customer,
      status: "pending",
      decor: service.decor,
      name: service.name,
      category: service.category,
      quantity: 1,
      price: session.amount_total / 100,
      image: service?.image,
    };
    const result = await bookingsCollection.insertOne(bookingInfo);
    // update plant quantity
    await bookingsCollection.updateOne(
      {
        _id: new ObjectId(session.metadata.serviceId),
      },
      { $inc: { quantity: -1 } }
    );

    return res.send({
      transactionId: session.payment_intent,
      bookingId: result.insertedId,
    });
  }
  res.send(
    res.send({
      transactionId: session.payment_intent,
      bookingId: booking._id,
    })
  );
});
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("Hello! Server is running soon");
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
