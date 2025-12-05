const request = require("supertest");
const app = require("../service");
const { DB, Role } = require("../database/database");

const testUser = {
  name: "pizza diner",
  email: `orders-user-${Date.now()}@test.com`,
  password: "a",
};

const adminCredentials = {
  name: "Orders Admin",
  email: `orders-admin-${Date.now()}@test.com`,
  password: "admin",
};

let menuId;
let franchiseId;
let storeId;

async function loginAndGetToken(credentials) {
  const res = await request(app).put("/api/auth").send(credentials);
  expect(res.status).toBe(200);
  expect(res.body.token).toBeDefined();
  return res.body.token;
}

let originalFetch;

beforeAll(async () => {
  originalFetch = global.fetch;
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          reportUrl: 'https://factory.example.com/report',
          jwt: 'factory-jwt',
        }),
    })
  );

  await request(app).post("/api/auth").send(testUser);

  await DB.addUser({ ...adminCredentials, roles: [{ role: Role.Admin }] });
  const adminToken = await loginAndGetToken({ email: adminCredentials.email, password: adminCredentials.password });

  const menuRes = await request(app)
    .put("/api/order/menu")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ title: `Veggie-${Date.now()}`, description: "A garden of delight", image: "pizza1.png", price: 0.0038 });
  expect(menuRes.status).toBe(200);
  menuId = menuRes.body[menuRes.body.length - 1].id;

  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `orders-franchise-${Date.now()}`, admins: [{ email: adminCredentials.email }] });
  expect(franchiseRes.status).toBe(200);
  franchiseId = franchiseRes.body.id;

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ franchiseId, name: "Orders Test Store" });
  expect(storeRes.status).toBe(200);
  storeId = storeRes.body.id;
});

afterAll(() => {
  global.fetch = originalFetch;
});


test("Get pizza menu", async () => {
  const res = await request(app).get("/api/order/menu");
  expect(res.status).toBe(200);
});

test("Add menu item", async () => {
  const userToken = await loginAndGetToken({ email: testUser.email, password: testUser.password });
  const res = await request(app)
    .put("/api/order/menu")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${userToken}`)
    .send({ title: "Student", description: "No topping, no sauce, just carbs", image: "pizza9.png", price: 0.0001 });
  expect(res.status).toBe(403); // only admin can add menu item
});

test("Get orders for user", async () => {
  const userToken = await loginAndGetToken({ email: testUser.email, password: testUser.password });
  const res = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${userToken}`);
  expect(res.status).toBe(200);
  //expect(res.body).toEqual({ dinerId: expect.any(Number), orders: [], page: 1 });
});

test("Create order for user", async () => {
  const userToken = await loginAndGetToken({ email: testUser.email, password: testUser.password });
  const res = await request(app)
    .post("/api/order")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${userToken}`)
    .send({ franchiseId, storeId, items: [{ menuId, description: "Veggie", price: 0.05 }] });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    order: { franchiseId, storeId, items: [{ menuId, description: "Veggie", price: expect.any(Number) }], id: expect.any(Number) },
    jwt: 'factory-jwt',
  });
  if (res.body.followLinkToEndChaos) {
    expect(typeof res.body.followLinkToEndChaos).toBe("string");
  }
});
