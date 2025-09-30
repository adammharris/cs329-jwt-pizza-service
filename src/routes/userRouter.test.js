/*
userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
];
*/

const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testUserId;

beforeAll(async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;
    testUserId = loginRes.body.user.id;
  expect(testUserAuthToken).toBeDefined();
});

test("Get authenticated user", async () => {
  const res = await request(app)
    .get("/api/user/me")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: expect.any(Number), name: expect.any(String), email: "reg@test.com", iat: expect.any(Number), roles: [{ role: "diner" }, {objectId: 2, role: "franchisee"}] });
});

test("Update user", async () => {
  const res = await request(app)
    .put(`/api/user/${testUserId}`)
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: "new name", email: "reg@test.com", password: "a" });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  const deleteRes = await request(app)
    .delete("/api/auth")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(deleteRes.status).toBe(200);
});