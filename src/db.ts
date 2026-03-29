import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default pool;

// Example using a generic update pattern
export const updateUserProfile = async (userId: string, profileData: any) => {
  // Logic to update your specific database
  // e.g., return await prisma.user.update({ where: { id: userId }, data: profileData });
  console.log(`Updating profile for user ${userId}`, profileData);
};
