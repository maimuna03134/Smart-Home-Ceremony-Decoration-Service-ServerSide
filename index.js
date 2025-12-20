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
    strict: false,
    deprecationErrors: true,
  },
});

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

async function run() {
  try {
    // await client.connect();
    const db = client.db("decor-service");

    const serviceCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const decoratorCollection = db.collection("decorators");

    // services related apis
    app.post("/services", async (req, res) => {
      const newService = req.body;
      const result = await serviceCollection.insertOne(newService);
      res.send(result);
    });

    app.get("/services", async (req, res) => {
      try {
        const { search, category, minPrice, maxPrice } = req.query;

        let query = {};

        if (search) {
          query.name = { $regex: search, $options: "i" };
        }

        if (category && category !== "all") {
          query.category = category;
        }

        if (minPrice || maxPrice) {
          query.price = {};
          if (minPrice) {
            query.price.$gte = parseFloat(minPrice);
          }
          if (maxPrice) {
            query.price.$lte = parseFloat(maxPrice);
          }
        }

        const result = await serviceCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching services:", error);
        res.status(500).send({ message: "Failed to fetch services" });
      }
    });

    // Get all unique categories for filter dropdown
    app.get("/services/categories/all", async (req, res) => {
      try {
        if (!serviceCollection) {
          return res
            .status(500)
            .send({ message: "service collection not initialized" });
        }
        const categories = await serviceCollection.distinct("category");
        // console.log('Categories found:', categories)
        res.send(categories || []);
      } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).send({ message: "Failed to fetch categories" });
      }
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const service = await serviceCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(service);
    });

    app.put("/services/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedService = req.body;

        console.log("📝 Updating service:", id);

        delete updatedService._id;

        updatedService.updatedAt = new Date();

        const result = await serviceCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedService }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Service not found" });
        }

        console.log("Service updated successfully");
        res.send(result);
      } catch (error) {
        console.error("Update service error:", error);
        res.status(500).send({ message: "Failed to update service" });
      }
    });

    app.delete("/services/:id", async (req, res) => {
      try {
        const id = req.params.id;

        console.log("🗑️ Deleting service:", id);

        const result = await serviceCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Service not found" });
        }

        console.log("✅ Service deleted successfully");
        res.send(result);
      } catch (error) {
        console.error("❌ Delete service error:", error);
        res.status(500).send({ message: "Failed to delete service" });
      }
    });

    // Create a new booking
    app.post("/bookings", async (req, res) => {
      try {
        const bookingsData = {
          ...req.body,
          status: "awaiting_decorator",
          paymentStatus: "paid",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(bookingsData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to create booking" });
      }
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
    app.get("/my-project/user/:email", async (req, res) => {
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
      console.log(paymentInfo);
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

    // users related apis
    app.post("/user", async (req, res) => {
      const userData = req.body;
      console.log(userData);

      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toDateString();

      userData.role = "customer";

      const query = {
        email: userData.email,
      };

      const alreadyExists = await usersCollection.findOne(query);
      console.log("user already exists", alreadyExists);

      if (alreadyExists) {
        console.log("update user info");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toDateString(),
          },
        });
        return res.send(result);
      }

      console.log("save in new user info");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    app.patch("/update-role", async (req, res) => {
      const { email, role } = req.body;
      console.log("Updating role for:", email, "New role:", role);

      const result = await usersCollection.updateOne(
        { email: email.trim().toLowerCase() },
        { $set: { role } }
      );

      res.send(result);
    });

    // decorator related apis
    app.post("/become-decorator", async (req, res) => {
      const { name, email, district } = req.body;

      const exists = await decoratorCollection.findOne({ email });
      if (exists) {
        return res.status(409).send({ message: "Already requested" });
      }

      const decoratorData = {
        name,
        email,
        district,
        status: "pending",
        workStatus: "available",
        createdAt: new Date(),
      };

      const result = await decoratorCollection.insertOne(decoratorData);
      res.send(result);
    });

    app.get("/decorators", async (req, res) => {
      const { status, workStatus } = req.query;
      const query = {};

      if (status) {
        query.status = status;
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }

      const cursor = decoratorCollection.find(query).sort({ createdAtd: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/decorators/:id", async (req, res) => {
      try {
        const { status, email } = req.body;
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };

        const result = await decoratorCollection.updateOne(query, updatedDoc);

        if (status === "approved" && email) {
          await usersCollection.updateOne(
            { email },
            { $set: { role: "decorator" } }
          );
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to update decorator" });
      }
    });

    app.delete("/decorators/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await decoratorCollection.deleteOne(query);

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to delete decorator" });
      }
    });

    // admin related apis
    //  All bookings for admin
    app.get("/bookings", async (req, res) => {
      try {
        const bookings = await bookingsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(bookings);
      } catch (error) {
        console.error("Error fetching all bookings:", error);
        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    // Cancel booking by admin
    app.patch("/bookings/:id/cancel", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        // Get booking info to check if decorator was assigned
        const booking = await bookingsCollection.findOne(query);

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // Update booking status to cancelled_by_admin
        const updatedDoc = {
          $set: {
            status: "cancelled_by_admin",
            cancelledAt: new Date(),
          },
        };

        const result = await bookingsCollection.updateOne(query, updatedDoc);

        // If decorator was assigned, make them available again
        if (booking.decoratorId) {
          await decoratorCollection.updateOne(
            { _id: new ObjectId(booking.decoratorId) },
            { $set: { workStatus: "available" } }
          );
        }

        res.send(result);
      } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).send({ message: "Failed to cancel booking" });
      }
    });

    //  Assign decorator to booking
    app.patch("/booking/:id", async (req, res) => {
      try {
        const { decoratorId, decoratorName, decoratorEmail } = req.body;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: {
            status: "decorator_assigned",
            decoratorId: decoratorId,
            decoratorName: decoratorName,
            decoratorEmail: decoratorEmail,
          },
        };

        const result = await bookingsCollection.updateOne(query, updatedDoc);

        // Update decorator information
        const decoratorQuery = { _id: new ObjectId(decoratorId) };
        const decoratorUpdatedDoc = {
          $set: {
            workStatus: "assigned",
          },
        };
        const decoratorResult = await usersCollection.updateOne(
          decoratorQuery,
          decoratorUpdatedDoc
        );

        res.send({
          bookingUpdate: result,
          decoratorUpdate: decoratorResult,
        });
      } catch (error) {
        console.error("Error assigning decorator:", error);
        res.status(500).send({ message: "Failed to assign decorator" });
      }
    });

    // Route to get bookings by payment status and booking status
    app.get("/booking-decorator", async (req, res) => {
      try {
        const { paymentStatus, status } = req.query;
        const query = {};

        if (paymentStatus) {
          query.paymentStatus = paymentStatus;
        }

        if (status) {
          query.status = status;
        }

        const result = await bookingsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    // Route to get decorators by location and status
    // app.get("/decorators", async (req, res) => {
    //   try {
    //     const { status, workStatus } = req.query;
    //     const query = {};

    //     if (status) {
    //       query.status = status;
    //     }

    //     if (workStatus) {
    //       query.workStatus = workStatus;
    //     }

    //     const result = await decoratorRequest.find(query).toArray();
    //     res.send(result);
    //   } catch (error) {
    //     console.error("Error fetching decorators:", error);
    //     res.status(500).send({ message: "Failed to fetch decorators" });
    //   }
    // });

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
