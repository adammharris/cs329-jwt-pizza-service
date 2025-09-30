const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;

beforeAll(async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;
  expect(testUserAuthToken).toBeDefined();
});


test("Get pizza menu", async () => {
  const res = await request(app).get("/api/order/menu");
  expect(res.status).toBe(200);
});

test("Add menu item", async () => {
  const res = await request(app)
    .put("/api/order/menu")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ title: "Student", description: "No topping, no sauce, just carbs", image: "pizza9.png", price: 0.0001 });
  expect(res.status).toBe(403); // only admin can add menu item
});

test("Get orders for user", async () => {
  const res = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  //expect(res.body).toEqual({ dinerId: expect.any(Number), orders: [], page: 1 });
});

test("Create order for user", async () => {
  const res = await request(app)
    .post("/api/order")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: "Veggie", price: 0.05 }] });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    order: { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: "Veggie", price: 0.05 }], id: expect.any(Number) },
    jwt: expect.any(String),
  });
});

