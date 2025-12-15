const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require("./homeDecorationServiceAdminSDK.json");
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
    // app.post("/bookings", async (req, res) => {
    //   try {
    //     const booking = req.body;

    //     if (req.decoded.email !== booking.userEmail) {
    //       return res.status(403).send({ message: "Forbidden access" });
    //     }

    //      if (
    //        !booking.serviceName ||
    //        !booking.bookingDate ||
    //        !booking.location
    //      ) {
    //        return res.status(400).send({
    //          message: "Missing required fields",
    //        });
    //      }

    //     const result = await bookingsCollection.insertOne(booking);
    //     res.send(result);
    //   } catch (error) {
    //     console.error("Create booking error:", error);
    //     res.status(500).send({ message: "Failed to create booking" });
    //   }
    // });

    app.post("/bookings", async (req, res) => {
      const newBooking = req.body;
      newBooking.createdAt = new Date();
      const result = await bookingsCollection.insertOne(newBooking);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const options = { sort: { createdAt: -1 } };

      const cursor = bookingsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // payment apis
 app.post("/payment-checkout-session", async (req, res) => {
   const paymentInfo = req.body;
   const amount = parseInt(paymentInfo.cost) * 100;
   const session = await stripe.checkout.sessions.create({
     line_items: [
       {
         price_data: {
           currency: "usd",
           unit_amount: amount,
           product_data: {
             name: `Please pay for: ${paymentInfo.serviceName}`,
           },
         },
         quantity: 1,
       },
     ],
     mode: "payment",
     metadata: {
       serviceId: paymentInfo.serviceId,
     },
     customer_email: paymentInfo.senderEmail,
     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
   });

   res.send({ url: session.url });
 });
    
    // Get all bookings for a specific user
    // app.get("/bookings/user/:email", async (req, res) => {
    //   const email = req.params.email;

    //    if (req.decoded.email !== email) {
    //      return res.status(403).send({ message: "Forbidden access" });
    //   }
      
    //    const bookings = await bookingsCollection
    //      .find({ userEmail: email })
    //      .sort({ createdAt: -1 })
    //      .toArray();

    //    res.send(bookings);
    // });

    // Get a single booking by ID
    app.get("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (req.decoded.email !== booking.userEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        res.send(booking);
      } catch (error) {
        console.error("Get booking error:", error);
        res.status(500).send({ message: "Failed to fetch booking" });
      }
    });

    // Update booking payment status
    app.patch("/bookings/:id/payment", async (req, res) => {
      try {
        const id = req.params.id;
        const { paymentStatus, transactionId } = req.body;

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (req.decoded.email !== booking.userEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              paymentStatus: paymentStatus,
              transactionId: transactionId,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Update payment status error:", error);
        res.status(500).send({ message: "Failed to update payment status" });
      }
    });

    // Cancel/Delete a booking
    app.delete("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (req.decoded.email !== booking.userEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        // Check if booking is already paid
        if (booking.paymentStatus === "Paid") {
          return res.status(400).send({
            message: "Cannot cancel a paid booking. Please contact support.",
          });
        }

        const result = await bookingsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error("Delete booking error:", error);
        res.status(500).send({ message: "Failed to cancel booking" });
      }
    });

    // payment related APIs
    app.post("/create-checkout-intent", async (req, res) => {
      try {
        const { price, bookingId } = req.body;
        const amount = parseInt(price * 100);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "bdt",
          payment_method_types: ["card"],
          metadata: {
            bookingId: bookingId,
          },
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Payment intent error:", error);
        res.status(500).send({ message: "Failed to create payment intent" });
      }
    });

    // Save payment to database
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;

        if (req.decoded.email !== payment.userEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const result = await paymentsCollection.insertOne(payment);
        res.send(result);
      } catch (error) {
        console.error("Save payment error:", error);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });

    // Get all payments for a user
    app.get("/payments/user/:email", async (req, res) => {
      try {
        const email = req.params.email;

        if (req.decoded.email !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const payments = await paymentsCollection
          .find({ userEmail: email })
          .sort({ paymentDate: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Get payments error:", error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
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
