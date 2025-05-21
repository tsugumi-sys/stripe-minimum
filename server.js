require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const path = require("path");

app.use(express.static("."));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const customerStore = new Map(); // key: userId, value: customerId

app.post("/create-checkout-session", async (req, res) => {
  const { priceId } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url:
        "http://localhost:4242/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:4242/canceled.html",
    });

    res.redirect(303, session.url);
  } catch (error) {
    res.status(500).send(`Error creating checkout session: ${error.message}`);
  }
});

// Optional success/cancel pages
app.get("/success.html", (req, res) => {
  res.send(
    '<h2>Thanks for subscribing!</h2><form action="/customer-portal" method="POST"><button type="submit">Manage Billing</button></form>',
  );
});

app.get("/canceled.html", (req, res) => {
  res.send("<h1>Payment canceled.</h1>");
});

// Stripe requires the raw body to validate the webhook signature
app.post("/webhook", async (req, res) => {
  let data;
  let eventType;
  // Check if webhook signing is configured.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    const signature = req.headers["stripe-signature"];

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret,
      );
    } catch (err) {
      console.log("⚠️  Webhook signature verification failed.");
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  switch (eventType) {
    case "checkout.session.completed":
      // Payment is successful and the subscription is created.
      // You should provision the subscription and save the customer ID to your database.
      const session = data.object;
      const customerId = session.customer;

      // Simulate logged-in user ID
      const userId = "user_123"; // Replace with req.user.id in real apps
      customerStore.set(userId, customerId);

      console.log(`✅ Saved customerId for ${userId}: ${customerId}`);

      break;
    case "invoice.paid":
      // Continue to provision the subscription as payments continue to be made.
      // Store the status in your database and check when a user accesses your service.
      // This approach helps you avoid hitting rate limits.
      break;
    case "invoice.payment_failed":
      // The payment failed or the customer does not have a valid payment method.
      // The subscription becomes past_due. Notify your customer and send them to the
      // customer portal to update their payment information.
      break;
    default:
      // Unhandled event type
  }

  res.sendStatus(200);
});

app.post("/customer-portal", async (req, res) => {
  const userId = "user_123"; // Simulate a logged-in user

  const customerId = customerStore.get(userId);
  if (!customerId) {
    return res.status(400).send("No customer ID found for user.");
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "http://localhost:4242/account.html",
    });

    res.redirect(303, portalSession.url);
  } catch (err) {
    console.error("❌ Error creating portal session:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(4242, () => console.log("Server running on http://localhost:4242"));
