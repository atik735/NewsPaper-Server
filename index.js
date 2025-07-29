require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SK_KEY);
 
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB client setup
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
 
async function run() {
  try {
    // await client.connect();
    console.log("Connected to MongoDB");

    // Collections
    const articlesCollection = client.db("articlesDB").collection("articles");
    const usersCollection = client.db("articlesDB").collection("users");
    const publishersCollection = client.db("articlesDB").collection("publishers");


    // USER ROUTES

    app.post('/user', async(req, res)=>{
      const userData = req.body
      userData.role = 'customer'
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.premiumTaken = null 
      const query = { email: userData?.email }
      const alreadyExists = await usersCollection.findOne(query)

      if (!!alreadyExists) {
        if (alreadyExists?.premiumTaken && new Date() > new Date(alreadyExists.premiumTaken)) {
          await usersCollection.updateOne(query, { $set: { premiumTaken: null } });
        }
        const result = await usersCollection.updateOne(query,{
          $set: { last_loggedIn: new Date().toISOString() }
        })
        return res.send(result)
      }
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })

    //email diye ekta user k get korar jonno...k premium taken nicche k nicche na
    app.get("/user", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).send({ message: "Email is required" });

      try {
        const user = await usersCollection.findOne({ email });
        if (user?.premiumTaken && new Date() > new Date(user.premiumTaken)) {
          await usersCollection.updateOne({ email }, { $set: { premiumTaken: null } });
          user.premiumTaken = null;
        }
        res.send(user);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch user" });
      }
    });
    //get a users role 

app.get('/user/role/:email', async(req,res)=>{

  const email = req.params.email;
  const result = await usersCollection.findOne({email})
  if (!result) return res.status(404).send({message: 'User Not Found'})
  res.send({role: result?.role})
})

    //sob user k get korar jonno
    app.get('/users', async (req, res) => {
      try {
      const result = await usersCollection.find().toArray();
      res.send(result);
    } catch (err) {
      console.error('Error fetching all users:', err);
      res.status(500).send({ message: 'Failed to fetch users' });
  }
  });

  app.patch("/user/:id", async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );
  res.send(result);
});

// PROFILE UPDATE ROUTE
app.patch("/user/profile/:id", async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid user ID" });
  }

  const updateData = req.body;
  delete updateData._id;   
  delete updateData.email; 

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.send(result);
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).send({ message: "Failed to update profile" });
  }
});





    app.get('/users/statistics', async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const premiumUsers = await usersCollection.countDocuments({ premiumTaken: { $ne: null } }); 
        const normalUsers = totalUsers - premiumUsers;
        res.json({ totalUsers, normalUsers, premiumUsers });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch statistics" });
      }
    });

    app.patch("/user/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      } catch (err) {
        console.error("Profile update error:", err.message);
        res.status(500).send({ message: "Failed to update profile" });
      }
    });

    // SUBSCRIPTION ROUTES
    app.post("/subscription", async (req, res) => {
      const { email, period } = req.body; 
      if (!email || !period) {
        return res.status(400).send({ message: "Email and period are required" });
      }

      let addTime;
      if (period === "1") {
        addTime = 1 * 60 * 1000; // 1 minute
      } else if (period === "5") {
        addTime = 5 * 24 * 60 * 60 * 1000; // 5 days
      } else if (period === "10") {
        addTime = 10 * 24 * 60 * 60 * 1000; // 10 days
      } else {
        return res.status(400).send({ message: "Invalid period" });
      }

      const premiumExpiry = new Date(Date.now() + addTime);

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { premiumTaken: premiumExpiry } },
          { upsert: true }
        );
        res.send({ success: true, premiumTaken: premiumExpiry });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update subscription" });
      }
    });

    // ARTICLE ROUTES
app.post("/articles", async (req, res) => {
  const article = req.body;
  if (!article.authorEmail) {
    return res.status(400).send({ message: "Author email is required" });
  }

  const author = await usersCollection.findOne({ email: article.authorEmail });
  if (!author) {
    return res.status(404).send({ message: "Author not found" });
  }

  article.authorName = author.name;
  article.authorEmail = author.email;
  article.authorImage = author.image;
  article.status = "pending";
  article.isPremium = false;
  article.views = 0;
  article.createdAt = new Date();

  try {
    const result = await articlesCollection.insertOne(article);
    res.send(result);
  } catch (err) {
    console.error("Error adding article:", err);
    res.status(500).send({ message: "Failed to add article" });
  }
});


    app.get("/articles/trending", async (req, res) => {
      try {
        const trending = await articlesCollection
          .find({ status: "approved" })
          .sort({ views: -1 })
          .limit(6)
          .toArray();
        res.send(trending);
      } catch (err) {
        console.error("Trending fetch error:", err);
        res.status(500).send({ message: "Failed to fetch trending articles" });
      }
    });

    // Show single Article + premium check + increase views
app.get("/articles/:id", async (req, res) => {
  const id = req.params.id;
  const email = req.query.email; 

  try {
    const article = await articlesCollection.findOne({ _id: new ObjectId(id) });
    if (!article) return res.status(404).send({ message: "Article not found" });

    if (article.isPremium) {
      const user = await usersCollection.findOne({ email });
      const now = new Date();
      const premiumExpires = new Date(user?.premiumTaken);

      if (!user || !user.premiumTaken || now > premiumExpires) {
        return res.status(403).send({ message: "Premium subscription required" });
      }
    }

    // views increase
    await articlesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { views: 1 } }
    );

    res.send(article);
  } catch (err) {
    console.error("Error fetching article:", err);
    res.status(500).send({ message: "Failed to fetch article" });
  }
});


    app.get("/articles", async (req, res) => {
      const { search, publisher, tags } = req.query;
      let filter = { status: "approved" };

      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }
      if (publisher) {
        filter.publisher = publisher;
      }
      if (tags) {
        filter.tags = { $in: tags.split(",") };
      }

      try {
        const articles = await articlesCollection.find(filter).toArray();
        res.send(articles);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch articles" });
      }
    });

    app.get("/admin/articles", async (req, res) => {
      const articles = await articlesCollection.find().toArray();
      res.send(articles);
    });

    app.patch("/articles/:id/premium", async (req, res) => {
      const id = req.params.id;
      const { isPremium } = req.body;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isPremium } }
      );
      res.send(result);
    });

    app.patch("/articles/:id/approve", async (req, res) => {
      const id = req.params.id;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved" } }
      );
      res.send(result);
    });

    app.get('/myarticles', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: 'Email is required' });
      }
      try {
        const articles = await articlesCollection.find({ authorEmail: email }).toArray();
        res.send(articles);
      } catch (err) {
        console.error('Error fetching user articles:', err);
        res.status(500).send({ message: 'Failed to fetch articles' });
      }
    });

    app.get('/myarticles/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const article = await articlesCollection.findOne({ _id: new ObjectId(id) });
        if (!article) {
          return res.status(404).send({ message: 'Article not found' });
        }
        res.send(article);
      } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).send({ message: 'Failed to fetch article' });
      }
    });

    app.put('/myarticles/:id', async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      try {
        const result = await articlesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              title: updateData.title,
              description: updateData.description,
              tags: updateData.tags,
              updatedAt: new Date()
            }
          }
        );
        res.send(result);
      } catch (err) {
        console.error('Error updating article:', err);
        res.status(500).send({ message: 'Failed to update article' });
      }
    });

    app.delete('/articles/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await articlesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        console.error('Error deleting article:', err);
        res.status(500).send({ message: 'Failed to delete article' });
      }
    });

    app.get('/premium-articles', async (req, res) => {
      const articles = await articlesCollection.find({ isPremium: true }).toArray();
      res.send(articles);
    });

    // Stripe PaymentIntent create
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ message: "Payment initiation failed" });
      }
    });


// Add decline reason field in article if declined
app.patch("/articles/:id/decline", async (req, res) => {
  const id = req.params.id;
  const { reason } = req.body;
  const result = await articlesCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "declined", declineReason: reason } }
  );
  res.send(result);
});



// Get all declined articles with reason (optional)
app.get("/admin/articles/declined", async (req, res) => {
  try {
    const declinedArticles = await articlesCollection
      .find({ status: "declined" })
      .project({ declineReason: 1, title: 1, authorEmail: 1 })
      .toArray();
    res.send(declinedArticles);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch declined articles" });
  }
});


//publisher all thing is here
app.post("/publishers", async (req, res) => {
  const { name, logo } = req.body;
  if (!name || !logo) return res.status(400).send({ message: "All fields required" });
  try {
    const result = await publishersCollection.insertOne({ name, logo });
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to add publisher" });
  }
});

app.get("/publishers", async (req, res) => {
  try {
    const publishers = await publishersCollection.find().toArray();
    res.send(publishers);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch publishers" });
  }
});

// Delete publisher
app.delete("/publishers/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await publishersCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    console.error("Error deleting publisher:", err);
    res.status(500).send({ message: "Failed to delete publisher" });
  }
});



    // BACKGROUND JOB: AUTO-EXPIRE PREMIUM
    setInterval(async () => {
      const now = new Date();
      await usersCollection.updateMany(
        { premiumTaken: { $lte: now } },
        { $set: { premiumTaken: null } }
      );
    }, 60 * 1000); // check every 1 min

  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send("Newspaper Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
