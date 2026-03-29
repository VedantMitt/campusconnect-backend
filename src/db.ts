import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// VERY IMPORTANT: Catch idle connection errors to prevent Node from crashing randomly
pool.on("error", (err, client) => {
  console.error("Unexpected error on idle pg client", err);
});

export default pool;

// Example using a generic update pattern
export const updateUserProfile = async (userId: string, profileData: any) => {
  // Logic to update your specific database
  // e.g., return await prisma.user.update({ where: { id: userId }, data: profileData });
  console.log(`Updating profile for user ${userId}`, profileData);
};
