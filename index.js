const express = require('express');
const app = express();
require('dotenv').config()
const jwt = require('jsonwebtoken');
const cors = require('cors')
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;


// middlewares
app.use(cors());
app.use(express.json());

// send email
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for port 465, false for other ports
    auth: {
      user: process.env.TRANSPORTER_EMAIL,
      pass: process.env.TRANSPORTER_PASS,
    },
  });

  const mailBody = {
    from: `"Coffee-shop-bd" <${process.env.TRANSPORTER_EMAIL}>`, // sender address
    to: emailAddress, // list of receivers
    subject: emailData.subject, // Subject line
    html: emailData.message, // html body
  }

  // verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });


  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log('Email Sent: ' + info.response);
    }
  });


}

// verify token
const verifyToken = (req, res, next) => {
  console.log('inside verify token', req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = req.headers.authorization.split(' ')[1]
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}



const { MongoClient, ServerApiVersion, Timestamp, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tthwvj5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const menuCollection = client.db('coffeeShopDb').collection('menu');
    const usersCollection = client.db('coffeeShopDb').collection('users');
    const bookingsCollection = client.db('coffeeShopDb').collection('bookings')


    // jwt related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      res.send({ token });
    })

    // get all menu item in db
    app.get('/menus', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    })

    // delete a menu data in db
    app.delete('/coffee/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })

    // save a coffee data in db
    app.post('/coffee', async (req, res) => {
      const coffeeData = req.body;
      const result = await menuCollection.insertOne(coffeeData);
      res.send(result);
    })

    // save a booking data in db
    app.post('/bookings', async (req, res) => {
      const bookingData = req.body;
      // save coffee booking info
      const result = await bookingsCollection.insertOne(bookingData)

      // send email to guest
      sendEmail(bookingData?.guest?.email, {
        subject: 'booking successful!',
        message: `You have successfully booked a room through Coffee Shop BD. Transaction Id: ${bookingData.transactionId}`
      })

      // send email to host
      sendEmail(bookingData?.host?.email, {
        subject: 'Your Coffee got ordered!',
        message: `Get ready to welcome ${bookingData?.guest.name}`
      })

      //change coffee availability status
      const coffeeId = bookingData.coffeeId;
      const query = { _id: new ObjectId(coffeeId) }
      const updateDoc = {
        $set: {
          booked: true
        }
      }
      const updateCoffee = await menuCollection.updateOne(query, updateDoc)
      console.log(updateCoffee);
      res.send({ result, updateCoffee });
    })

    // get a my listing data in db
    app.get('/my-listings/:email', async (req, res) => {
      const email = req.params.email;
      let query = { 'host.email': email }
      const result = await menuCollection.find(query).toArray();
      res.send(result);
    })

    // get a single coffee details in db
    app.get('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result)
    })

    // create-payment-intent
    app.post('/create-payment-intent', async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100
      if (!price || priceInCent < 1) return

      // generate client secret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      })
      // send client secret in response
      res.send({ clientSecret: client_secret })
    })

    // save a user data in db
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check if user already in db
      const isExists = await usersCollection.findOne(query);
      if (isExists) {
        if (user.status === 'Requested') {
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status }
          })
          return res.send(result)
        } else {
          return res.send(isExists)
        }
      }

      // save user for the first time
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          ...user,
          Timestamp: Date.now(),
        }
      }
      const result = await usersCollection.updateOne(query, updateDoc, options)
      // welcome new user
      sendEmail(user?.email, {
        subject: 'Welcome our coffee shop',
        message: `Visit Our Shop and order your favorite Coffee`
      })


      res.send(result);
    })

    // get a single email in db
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email })
      res.send(result);
    })

    // middleWares

    // use verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      const isAdmin = user?.role === 'admin'
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }



    // get all users data from database
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {

      const result = await usersCollection.find().toArray();
      res.send(result);
    })

    // update user role
    app.patch('/users/update/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email }
      const updateDoc = {
        $set: {
          ...user,
          Timestamp: Date.now()
        }
      }
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    })

    // get bookings data for guest
    app.get('/my-bookings/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'guest.email': email }
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    })

    // get manage bookings data for host
    app.get('/manage-bookings/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result)
    })

    // delete a booking data
    app.delete('/booking/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await bookingsCollection.deleteOne(query)
      res.send(result);
    })

    // admin statistics
    app.get('/admin-stat', async (req, res) => {
      const bookingDetails = await bookingsCollection.find({}, {
        projection: {
          price: 1
        }
      }).toArray()

      const totalUser = await usersCollection.countDocuments()
      const totalCoffee = await menuCollection.countDocuments()
      const totalPrice = bookingDetails.reduce((sum, booking) => sum + booking.price, 0)

      const chartData = bookingDetails.map(booking => {
        // const day = new Date(booking.date).getDate();
        // const month = new Date(booking.date).getMonth() + 1
        const data = [booking.price]
        return data;
      })
      chartData.unshift(['sales'])

      console.log(chartData);

      console.log(bookingDetails);
      res.send({ totalUser, totalCoffee, totalBookings: bookingDetails.length, totalPrice, chartData })
    })

    // host statistics
    //  app.get('/host-stat',  async (req, res) => {
    //   const {email} = req.user
    //   console.log(email);
    //   const bookingDetails = await bookingsCollection.find({'host.email': email}, {
    //     projection: {
    //       price: 1
    //     }
    //   }).toArray()


    //   const totalCoffee = await menuCollection.countDocuments({'host.email': email})
    //   const totalPrice = bookingDetails.reduce((sum, booking) => sum + booking.price, 0)

    //   // const {TimeStamp} = await usersCollection.findOne({email}, {projection: {TimeStamp: 1}}) 
    //   // console.log(TimeStamp);
    //   const chartData = bookingDetails.map(booking => {
    //     // const day = new Date(booking.date).getDate();
    //     // const month = new Date(booking.date).getMonth() + 1
    //     const data = [booking.price]
    //     return data;
    //   })
    //   chartData.unshift(['sales'])

    //   console.log(chartData);

    //   console.log(bookingDetails);
    //   res.send({ totalCoffee, totalBookings: bookingDetails.length, totalPrice, chartData,  })
    // })

    app.get('/host-stat', async (req, res) => {
      const email = req.body;
      // console.log(email);
      const users = await usersCollection.estimatedDocumentCount()
      const bookings = await bookingsCollection.estimatedDocumentCount()
      const totalCoffee = await menuCollection.estimatedDocumentCount()
      res.send({ users, bookings, totalCoffee, })
    })

    // update coffee data
    app.put('/coffee/update/:id', async (req, res) => {
      const id = req.params.id;
      const coffeeData = req.body;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: coffeeData
      }
      const result = await menuCollection.updateOne(query, updateDoc)
      res.send(result)
    })




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('coffee shop is running')
})

app.listen(port, (req, res) => {
  console.log(`coffee shop is sitting on port ${port}`);
})