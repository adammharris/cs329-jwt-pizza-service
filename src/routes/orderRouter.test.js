const request = require("supertest");
const app = require("../service");
const { DB, Role } = require("../database/database");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
const adminCredentials = {
  name: "Orders Admin",
  email: `orders-admin-${Date.now()}@test.com`,
  password: "admin",
};

let testUserAuthToken;
let adminAuthToken;
let menuId;
let franchiseId;
let storeId;

beforeAll(async () => {
  await request(app).post("/api/auth").send(testUser);
  const loginRes = await request(app)
    .put("/api/auth")
    .send({ email: testUser.email, password: testUser.password });
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;
  expect(testUserAuthToken).toBeDefined();

  await DB.addUser({ ...adminCredentials, roles: [{ role: Role.Admin }] });
  const adminLoginRes = await request(app)
    .put("/api/auth")
    .send({ email: adminCredentials.email, password: adminCredentials.password });
  expect(adminLoginRes.status).toBe(200);
  adminAuthToken = adminLoginRes.body.token;

  const menuRes = await request(app)
    .put("/api/order/menu")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ title: "Veggie", description: "A garden of delight", image: "pizza1.png", price: 0.0038 });
  expect(menuRes.status).toBe(200);
  const lastMenuItem = menuRes.body[menuRes.body.length - 1];
  menuId = lastMenuItem.id;

  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ name: `orders-franchise-${Date.now()}`, admins: [{ email: adminCredentials.email }] });
  expect(franchiseRes.status).toBe(200);
  franchiseId = franchiseRes.body.id;

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ franchiseId, name: "Orders Test Store" });
  expect(storeRes.status).toBe(200);
  storeId = storeRes.body.id;
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
    .send({ franchiseId, storeId, items: [{ menuId, description: "Veggie", price: 0.05 }] });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    order: { franchiseId, storeId, items: [{ menuId, description: "Veggie", price: 0.05 }], id: expect.any(Number) },
    jwt: expect.any(String),
  });
  if (res.body.followLinkToEndChaos) {
    expect(typeof res.body.followLinkToEndChaos).toBe("string");
  }
});

