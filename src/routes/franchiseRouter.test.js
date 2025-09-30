const request = require("supertest");
const app = require("../service");
const { DB, Role } = require("../database/database");

const adminCredentials = {
  name: "CI Admin",
  email: `ci-admin-${Date.now()}@test.com`,
  password: "admin",
};

const testFranchise = {
  name: `pizzaPocket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  admins: [{ email: adminCredentials.email }],
  stores: [{ name: "SLC", totalRevenue: 0 }],
};

let testUserAuthToken;
let testFranchiseId;

beforeAll(async () => {
  await DB.addUser({ ...adminCredentials, roles: [{ role: Role.Admin }] });
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ email: adminCredentials.email, password: adminCredentials.password });
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;

  const registerRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(testFranchise);
  expect(registerRes.status).toBe(200);
  testFranchiseId = registerRes.body.id;
});

test("list all franchises", async () => {
  const listRes = await request(app)
    .get(`/api/franchise?page=0&limit=25&name=${encodeURIComponent(testFranchise.name)}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.franchises).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: testFranchiseId, name: testFranchise.name })])
  );
});

test("New franchise store", async () => {
  const createStoreRes = await request(app)
    .post(`/api/franchise/${testFranchiseId}/store`)
    .set("Content-Type", "application/json")
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ franchiseId: testFranchiseId, name: "LAX" });
  expect(createStoreRes.status).toBe(200);
  expect(createStoreRes.body).toEqual(
    expect.objectContaining({ id: expect.any(Number), name: "LAX" })
  );
});

afterAll(async () => {
  await request(app)
    .delete(`/api/franchise/${testFranchiseId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
});
