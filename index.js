const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require("./homeDecorationServiceAdminSDK.json");
const app = express();
const port = process.env.PORT || 5000;
// const crypto = require("crypto");

// function generateTrackingId() {
//   const prefix = "PRCL"; // your brand prefix
//   const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
//   const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

//   return `${prefix}-${date}-${random}`;
// }

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

// JWT Verification Middleware
// const verifyJWT = (req, res, next) => {
//   const authorization = req.headers.authorization;
//   if (!authorization) {
//     return res.status(401).send({ message: "Unauthorized access" });
//   }
//   const token = authorization.split(" ")[1];
//   jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
//     if (err) {
//       return res.status(401).send({ message: "Unauthorized access" });
//     }
//     req.decoded = decoded;
//     next();
//   });
// };

async function run() {
  try {
    // await client.connect();
    const db = client.db("decor-service");

    const serviceCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("users");

    // JWT token
    //  app.post("/jwt", async (req, res) => {
    //    const user = req.body;
    //    const token = jwt.sign(user, process.env.JWT_SECRET, {
    //      expiresIn: "7d",
    //    });
    //    res.send({ token });
    //  });

    app.get("/services", async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    });
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const service = await serviceCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(service);
    });

    app.post("/services", async (req, res) => {
      const newService = req.body;
      const result = await serviceCollection.insertOne(newService);
      res.send(result);
    });

    // Create a new booking
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      booking.createdAt = new Date();
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // Get all bookings for a specific user
    app.get("/bookings/user/:email", async (req, res) => {
      const email = req.params.email;

      const bookings = await bookingsCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(bookings);
    });

    // Get a single booking by ID
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // Cancel/Delete a booking
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({
          message: "Booking not found",
        });
      }

      if (booking.paymentStatus === "Paid") {
        return res.status(400).send({
          message: "Cannot cancel a paid booking. Please contact support.",
        });
      }

      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // Update booking (date and location only for unpaid bookings)
    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const { bookingDate, location } = req.body;

      console.log(id);

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (booking.payment_status === "Paid") {
        return res.status(400).send({
          message: "Cannot update paid booking. Please contact support.",
        });
      }

      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            bookingDate: bookingDate,
            location: location,
            updatedAt: new Date().toISOString(),
          },
        }
      );

      res.send(result);
    });

    // get all bookings for a customer by email
    app.get("/my-booking/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await bookingsCollection
        .find({
          userEmail: email,
        })
        .toArray();
      res.send(result);
    });

    // get all bookings for a decorator by email
    app.get("/manage-booking/user/:email", async (req, res) => {
      const email = req.params.email;

      const result = await bookingsCollection
        .find({ "decorator.email": email })
        .toArray();
      res.send(result);
    });

    // get all service for a decorator by email
    app.get("/my-inventory/user/:email", async (req, res) => {
      const email = req.params.email;

      const result = await serviceCollection
        .find({ "decorator.email": email })
        .toArray();
      res.send(result);
    });

    // Get all payments for a user
    app.get("/payments/user/:email", async (req, res) => {
      const email = req.params.email;

      const payments = await paymentsCollection
        .find({ customer: email })
        .sort({ paymentDate: -1 })
        .toArray();

      res.send(payments);
    });

    // payment related APIs
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo);
      // console.log(paymentInfo.serviceImage);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: paymentInfo?.serviceName,
                description: paymentInfo?.serviceCategory,
                images: [paymentInfo?.serviceImage],
              },
              unit_amount: paymentInfo?.servicePrice * 100,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: "payment",
        metadata: {
          bookingId: paymentInfo?.bookingId,
          customer: paymentInfo?.customer.email,
          serviceName: paymentInfo?.serviceName,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-bookings`,
      });
      res.send({ url: session.url });
    });

    
    
    app.patch("/payment-success", async (req, res) => {
      const { sessionId } = req.body; 

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.send({ success: false, message: "Payment not completed" });
      }

      const bookingId = session.metadata.bookingId;
      const query = { _id: new ObjectId(bookingId) };
      const update = {
        $set: {
          paymentStatus: "Paid",
          transactionId: session.payment_intent,
          updatedAt: new Date(),
        },
      };

      const result = await bookingsCollection.updateOne(query, update);

      const paymentRecord = {
        paymentId: session.metadata.bookingId,
        transactionId: session.payment_intent,
        customer: session.metadata.customer,
        status: "completed",
        serviceName: session.metadata.serviceName,
        quantity: 1,
        price: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        paymentDate: new Date().toISOString(),
      };

      const resultPayment = await paymentsCollection.insertOne(paymentRecord);

      return res.send({
        success: true,
        modifyBooking: result,
        transactionId: session.payment_intent,
        paymentId: resultPayment.insertedId,
        message: "Payment verified and booking updated successfully",
      });
    });

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
