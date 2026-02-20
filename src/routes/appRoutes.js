import express from "express";
import * as appController from "../controllers/appController.js";
import authenticateToken from "../middleware/authMiddleware.js";


const router = express.Router();


//Upload App (for developers)
router.post("/upload", authenticateToken, appController.uploadApp);

//Update App (for developers)
router.put("/:id", authenticateToken, appController.updateApp);

router.get("/stats",authenticateToken, appController.getDeveloperStats);

// Get all apps
router.get("/", appController.getAllApps);

//GET My Apps
router.get("/my-apps", authenticateToken, appController.getMyApps);

//Protected Stats route
router.get("/stats", authenticateToken, appController.getDeveloperStats);

// Get app by ID
router.get("/get/:id", appController.getAppById);

// Delete app by ID
router.delete("/delete/:id", authenticateToken, appController.deleteApp);


// Download an app file
router.get("/download/:fileName", appController.appDownload);

export default router;

