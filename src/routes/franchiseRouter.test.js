const request = require("supertest");
const app = require("../service");

const testFranchise = {
  id: 1,
  name: "pizzaPocket",
  admins: [{ id: 4, name: "pizza diner", email: "a@jwt.com" }],
  stores: [{ id: 1, name: "SLC", totalRevenue: 0 }],
};
testFranchise.name = `${testFranchise.name}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
let testUserAuthToken;
let testFranchiseId;

beforeAll(async () => {
  const loginRes = await request(app).put('/api/auth').send({ email: 'a@jwt.com', password: 'admin' });
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;

  const registerRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(testFranchise);
  expect(registerRes.status).toBe(200);
  testFranchiseId = registerRes.body.id;

  //expect(registerRes.body).toEqual(testFranchise);
});

test("list all franchises", async () => {
  const listRes = await request(app)
    .get(`/api/franchise?page=0&limit=10&name=*`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.franchises.length).toEqual(10);
});

test("New franchise store", async () => {
  const createStoreRes = await request(app)
    .post(`/api/franchise/${testFranchiseId}/store`)
    .set("Content-Type", "application/json")
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ franchiseId: testFranchise.id, name: "LAX" });
  expect(createStoreRes.status).toBe(200);
  //expect(createStoreRes.body).toEqual({ id: 1, name: "SLC", totalRevenue: 0 });
});

afterAll(async () => {
  const deleteRes = await request(app)
    .delete(`/api/franchise/${testFranchise.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);
});
