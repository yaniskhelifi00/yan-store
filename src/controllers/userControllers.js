// controllers/userController.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

export const updateUser = async (req, res) => {
  try {
    const userId = req.user.id; // ✅ from JWT
    const { name, email, password } = req.body;

    let updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    res.json({ message: "User updated successfully", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
};


export const getUser = async (req, res) => {
  try
  {
    const userId = req.user.id; // ✅ from JWT
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true},
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to retrieve user", error: error.message });
  }
}