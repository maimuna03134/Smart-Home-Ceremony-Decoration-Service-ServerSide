const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

const admin = require("firebase-admin");
const serviceAccount = require("./homeDecorationServiceAdminSDK.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.imnpg23.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

// jwt middlewares
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

   if (!token) {
     return res.status(401).send({ message: "unauthorized access" });
  }

  if (!token.startsWith("Bearer ")) {
    console.log("Invalid token format");
    return res
      .status(401)
      .send({ message: "Unauthorized access - Invalid token format" });
  }
  
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded = { email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
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

    // Role verification middlewares
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
   
      const user = await usersCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };
    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded.email;

      const user = await usersCollection.findOne({ email });

      if (user?.role !== "decorator") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // services related apis
    app.post("/services", verifyFBToken, verifyAdmin, async (req, res) => {
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

    app.patch("/services/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedService = req.body;
        delete updatedService._id;
        updatedService.updatedAt = new Date();

        const result = await serviceCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedService }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Service not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Update service error:", error);
        res.status(500).send({ message: "Failed to update service" });
      }
    });

    app.delete(
      "/services/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await serviceCollection.deleteOne({
            _id: new ObjectId(id),
          });

          if (result.deletedCount === 0) {
            return res.status(404).send({ message: "Service not found" });
          }

          res.send(result);
        } catch (error) {
          console.error("Delete service error:", error);
          res.status(500).send({ message: "Failed to delete service" });
        }
      }
    );

    // Create a new booking
    app.post("/bookings", verifyFBToken, async (req, res) => {
      try {
        const bookingData = req.body;

        // Verify user email matches token
        if (bookingData.userEmail !== req.decoded.email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        const bookingsData = {
          ...bookingData,
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

    // Check if user has already booked a service
    app.get("/bookings/check", async (req, res) => {
      try {
        const { userEmail, serviceId } = req.query;

        if (!userEmail || !serviceId) {
          return res
            .status(400)
            .json({ message: "Missing required parameters" });
        }

        const booking = await bookingsCollection.findOne({
          userEmail: userEmail,
          serviceId: serviceId,
          // Only check for active bookings (not cancelled/deleted)
          status: { $nin: ["Cancelled", "Deleted"] },
        });

        res.json({
          hasBooked: !!booking,
          booking: booking || null,
        });
      } catch (error) {
        console.error("Error checking booking:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get all bookings for a specific user
    app.get("/bookings", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const {
          page = 1,
          limit = 10,
          sortBy = "createdAt",
          sortOrder = "desc",
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

        const bookings = await bookingsCollection
          .find()
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const total = await bookingsCollection.countDocuments();

        res.send({
          bookings,
          totalPages: Math.ceil(total / parseInt(limit)),
          currentPage: parseInt(page),
          total,
        });
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    // Get a single booking by ID
    app.get("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }

      // Check if user owns this booking or is admin
      const user = await usersCollection.findOne({ email: req.decoded.email });

      if (booking.userEmail !== req.decoded.email && user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      res.send(booking);
    });

    // Update booking (date and location only for unpaid bookings)
    app.patch("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const { bookingDate, location } = req.body;

      console.log(id);

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }
      // Check permissions
      const user = await usersCollection.findOne({ email: req.decoded.email });
      const isOwner = booking.userEmail === req.decoded.email;
      const isAdmin = user?.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      // User can't update paid bookings
      if (isOwner && booking.paymentStatus === "Paid") {
        return res.status(400).send({
          message: "Cannot update paid booking",
        });
      }

      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            bookingDate,
            location,
            updatedAt: new Date(),
          },
        }
      );

      res.send(result);
    });

    // Cancel/Delete a booking
    app.delete("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({
          message: "Booking not found",
        });
      }

      // Check permissions
      const user = await usersCollection.findOne({ email: req.decoded.email });
      const isOwner = booking.userEmail === req.decoded.email;
      const isAdmin = user?.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      // User can't delete paid bookings
      if (isOwner && booking.paymentStatus === "Paid") {
        return res.status(400).send({
          message: "Cannot cancel paid booking. Contact support.",
        });
      }

      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // get all bookings for a customer by email
    app.get("/my-booking/user/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      // Check if token email matches requested email
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const result = await bookingsCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
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
    // app.get("/my-project/user/:email", async (req, res) => {
    //   const email = req.params.email;

    //   const result = await serviceCollection
    //     .find({ "decorator.email": email })
    //     .toArray();
    //   res.send(result);
    // });

    // Get all payments for a user
    app.get("/payments/user/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const payments = await paymentsCollection
        .find({ customer: email })
        .sort({ paymentDate: -1 })
        .toArray();

      res.send(payments);
    });

    // payment related APIs
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log("Payment Info received:", paymentInfo);

      if (!paymentInfo.servicePrice || paymentInfo.servicePrice < 50) {
        return res.status(400).send({
          message: "Service price must be at least 50 BDT",
        });
      }

      if (!paymentInfo.serviceImage || !paymentInfo.serviceName) {
        return res.status(400).send({
          message: "Missing required payment information",
        });
      }
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

      userData.role = "user";

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

    app.patch("/update-role", verifyFBToken, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      console.log("Updating role for:", email, "New role:", role);

      const result = await usersCollection.updateOne(
        { email: email.trim().toLowerCase() },
        { $set: { role } }
      );

      res.send(result);
    });

    // DECORATOR DASHBOARD APIs
    app.post("/become-decorator", verifyFBToken, async (req, res) => {
      try {
        const { name, email, district, specialties } = req.body;

        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        const exists = await decoratorCollection.findOne({ email });
        if (exists) {
          return res.status(409).send({ message: "Already requested" });
        }

        const decoratorData = {
          name,
          email,
          district,
          specialties: specialties || [], 
          status: "pending",
          workStatus: "available",
          rating: 0, 
          completedProjects: 0,
          reviews: 0,
          bio: "",
          photo: null,
          createdAt: new Date(),
        };

        const result = await decoratorCollection.insertOne(decoratorData);
        res.send(result);
      } catch (error) {
        console.error(" Error in become-decorator:", error);
        res.status(500).send({
          message: "Failed to process request",
          error: error.message,
        });
      }
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

    app.patch(
      "/decorators/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { status, email } = req.body;
          const id = req.params.id;

          const query = { _id: new ObjectId(id) };
          const updatedDoc = {
            $set: {
              status: status,
            },
          };
          //  Set workStatus based on status

          if (status === "approved") {
            updatedDoc.$set.workStatus = "available";
          } else if (status === "disabled") {
            updatedDoc.$set.workStatus = "unavailable";
          } else if (status === "rejected") {
            updatedDoc.$set.workStatus = "unavailable";
          }
          const result = await decoratorCollection.updateOne(query, updatedDoc);

          // Update user role in usersCollection
          if (email) {
            if (status === "approved") {
              // Set role to decorator when approved
              await usersCollection.updateOne(
                { email },
                { $set: { role: "decorator" } }
              );
            } else if (status === "disabled" || status === "rejected") {
              // Remove decorator role when disabled/rejected
              await usersCollection.updateOne(
                { email },
                { $set: { role: "user" } }
              );
            }
          }

          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update decorator" });
        }
      }
    );

    app.delete(
      "/decorators/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          const query = { _id: new ObjectId(id) };

          // Get decorator info before deleting
          const decorator = await decoratorCollection.findOne(query);

          // Delete decorator
          const result = await decoratorCollection.deleteOne(query);

          // Remove decorator role from user
          if (decorator?.email) {
            await usersCollection.updateOne(
              { email: decorator.email },
              { $set: { role: "user" } }
            );
          }

          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to delete decorator" });
        }
      }
    );

    // Get all assigned projects for a decorator
    app.get(
      "/decorator/assigned-projects/:email",
      verifyFBToken,
      verifyDecorator,
      async (req, res) => {
        try {
          const email = req.params.email;

          if (req.decoded.email !== email) {
            return res.status(403).send({ message: "Forbidden Access" });
          }

          const projects = await bookingsCollection
            .find({
              decoratorEmail: email,
              paymentStatus: "Paid",
            })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(projects);
        } catch (error) {
          console.error("Error fetching decorator projects:", error);
          res.status(500).send({ message: "Failed to fetch projects" });
        }
      }
    );

    // Get today's schedule for a decorator
    app.get(
      "/decorator/todays-schedule/:email",
      verifyFBToken,
      verifyDecorator,
      async (req, res) => {
        try {
          const email = req.params.email;

          if (req.decoded.email !== email) {
            return res.status(403).send({ message: "Forbidden Access" });
          }

          // Get today's date range
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          const schedule = await bookingsCollection
            .find({
              decoratorEmail: email,
              paymentStatus: "Paid",
              createdAt: {
                $gte: today,
                $lt: tomorrow,
              },
              status: {
                $nin: ["completed", "cancelled_by_admin"],
              },
            })
            .sort({ createdAt: 1 })
            .toArray();

          res.send(schedule);
        } catch (error) {
          console.error("Error fetching today's schedule:", error);
          res.status(500).send({ message: "Failed to fetch schedule" });
        }
      }
    );

    // Update project status by decorator
    app.patch(
      "/decorator/update-status/:bookingId",
      verifyFBToken,
      verifyDecorator,
      async (req, res) => {
        try {
          const bookingId = req.params.bookingId;
          const { status } = req.body;

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(bookingId),
          });
          // Verify decorator owns this booking
          if (booking.decoratorEmail !== req.decoded.email) {
            return res.status(403).send({ message: "Forbidden Access" });
          }

          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            {
              $set: {
                status: status,
                updatedAt: new Date(),
              },
            }
          );

          // Make decorator available when completed
          if (status === "completed" && booking?.decoratorId) {
            await decoratorCollection.updateOne(
              { _id: new ObjectId(booking.decoratorId) },
              { $set: { workStatus: "available" } }
            );
          }

          res.send(result);
        } catch (error) {
          console.error("Error updating status:", error);
          res.status(500).send({ message: "Failed to update status" });
        }
      }
    );

    // Get earnings summary for decorator
    app.get(
      "/decorator/earnings/:email",
      verifyFBToken,
      verifyDecorator,
      async (req, res) => {
        try {
          const email = req.params.email;

          // Get all bookings for this decorator
          const allBookings = await bookingsCollection
            .find({
              decoratorEmail: email,
              paymentStatus: "Paid",
            })
            .sort({ createdAt: -1 })
            .toArray();

          // Calculate total earnings from completed projects
          const completedBookings = allBookings.filter(
            (b) => b.status === "completed"
          );
          const totalEarnings = completedBookings.reduce((sum, booking) => {
            return sum + (booking.servicePrice || 0);
          }, 0);

          // Count projects by status
          const completedProjects = completedBookings.length;
          const ongoingProjects = allBookings.filter(
            (b) =>
              b.status === "in_progress" || b.status === "decorator_assigned"
          ).length;

          res.send({
            totalEarnings,
            completedProjects,
            ongoingProjects,
            paymentHistory: allBookings,
          });
        } catch (error) {
          console.error("Error fetching earnings:", error);
          res.status(500).send({ message: "Failed to fetch earnings" });
        }
      }
    );

    app.get("/decorators/top", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 6;

        const topDecorators = await decoratorCollection
          .find({
            status: "approved",
            workStatus: "available",
          })
          .sort({ rating: -1, completedProjects: -1 })
          .limit(limit)
          .toArray();

        res.send(topDecorators);
      } catch (error) {
        console.error("Error fetching top decorators:", error);
        res.status(500).send({ message: "Failed to fetch top decorators" });
      }
    });

    app.patch(
      "/decorators/:id/profile",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const {
            rating,
            specialties,
            completedProjects,
            reviews,
            bio,
            photo,
          } = req.body;

          const result = await decoratorCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                rating,
                specialties,
                completedProjects,
                reviews,
                bio,
                photo,
                updatedAt: new Date(),
              },
            }
          );

          res.send(result);
        } catch (error) {
          console.error("Error updating decorator profile:", error);
          res.status(500).send({ message: "Failed to update profile" });
        }
      }
    );

    // admin related apis

    // Cancel booking by admin
    app.patch(
      "/bookings/:id/cancel",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!booking) {
            return res.status(404).send({ message: "Booking not found" });
          }

          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: "cancelled_by_admin",
                cancelledAt: new Date(),
              },
            }
          );

          // Make decorator available if assigned
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
      }
    );

    //  Assign decorator to booking
    app.patch("/booking/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { decoratorId, decoratorName, decoratorEmail } = req.body;
        const id = req.params.id;

        const updatedDoc = {
          $set: {
            status: "decorator_assigned",
            decoratorId,
            decoratorName,
            decoratorEmail,
          },
        };

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          updatedDoc
        );

        // Update decorator status
        await decoratorCollection.updateOne(
          { _id: new ObjectId(decoratorId) },
          { $set: { workStatus: "assigned" } }
        );

        res.send({ success: true, result });
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

    // Admin Analytics API
    app.get(
      "/admin/analytics",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const allBookings = await bookingsCollection.find().toArray();

          const totalRevenue = allBookings.reduce((sum, booking) => {
            return sum + (booking.servicePrice || 0);
          }, 0);

          const paidBookings = allBookings.filter(
            (b) => b.paymentStatus === "Paid"
          );
          const paidRevenue = paidBookings.reduce((sum, booking) => {
            return sum + (booking.servicePrice || 0);
          }, 0);

          const unpaidBookings = allBookings.filter(
            (b) => b.paymentStatus !== "Paid"
          );
          const unpaidRevenue = unpaidBookings.reduce((sum, booking) => {
            return sum + (booking.servicePrice || 0);
          }, 0);

          const serviceDemandMap = {};
          allBookings.forEach((booking) => {
            const serviceName = booking.serviceName || "Unknown";
            const category = booking.serviceCategory || "Other";
            const price = booking.servicePrice || 0;

            if (!serviceDemandMap[serviceName]) {
              serviceDemandMap[serviceName] = {
                serviceName: serviceName,
                category: category,
                bookingCount: 0,
                totalRevenue: 0,
              };
            }
            serviceDemandMap[serviceName].bookingCount += 1;
            serviceDemandMap[serviceName].totalRevenue += price;
          });

          const serviceDemand = Object.values(serviceDemandMap)
            .sort((a, b) => b.bookingCount - a.bookingCount)
            .slice(0, 10); // Top 10 services

          const categoryRevenueMap = {};
          allBookings.forEach((booking) => {
            const category = booking.serviceCategory || "Other";
            const price = booking.servicePrice || 0;

            if (!categoryRevenueMap[category]) {
              categoryRevenueMap[category] = {
                name: category,
                revenue: 0,
                count: 0,
              };
            }
            categoryRevenueMap[category].revenue += price;
            categoryRevenueMap[category].count += 1;
          });

          const categoryRevenue = Object.values(categoryRevenueMap);

          const monthlyRevenueMap = {};
          const monthNames = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];

          allBookings.forEach((booking) => {
            if (booking.createdAt) {
              const date = new Date(booking.createdAt);
              const monthYear = `${
                monthNames[date.getMonth()]
              } ${date.getFullYear()}`;

              if (!monthlyRevenueMap[monthYear]) {
                monthlyRevenueMap[monthYear] = {
                  month: monthYear,
                  revenue: 0,
                  bookings: 0,
                };
              }
              monthlyRevenueMap[monthYear].revenue += booking.servicePrice || 0;
              monthlyRevenueMap[monthYear].bookings += 1;
            }
          });

          const monthlyRevenue = Object.values(monthlyRevenueMap).slice(-6);

          res.send({
            totalRevenue,
            paidRevenue,
            unpaidRevenue,
            totalBookings: allBookings.length,
            paidBookings: paidBookings.length,
            unpaidBookings: unpaidBookings.length,
            serviceDemand,
            categoryRevenue,
            monthlyRevenue,
          });
        } catch (error) {
          console.error("Error fetching analytics:", error);
          res.status(500).send({ message: "Failed to fetch analytics" });
        }
      }
    );

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
