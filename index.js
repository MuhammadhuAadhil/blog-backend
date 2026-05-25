const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MONGODB_URI = process.env.MONGODB_URI || (IS_PRODUCTION ? "" : "mongodb://127.0.0.1:27017/blog");
const ADMIN_UID = "NIOdBl7v8IVnYVTz0nAhTSPaExJ2";
const MONGO_RETRY_DELAY_MS = 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN?.trim();

app.use(
  cors(
    CLIENT_ORIGIN
      ? {
          origin: CLIENT_ORIGIN,
        }
      : undefined
  )
);
app.use(express.json());

mongoose.connection.on("connected", () => {
  console.log(`MongoDB connected successfully: ${MONGODB_URI}`);
});

mongoose.connection.on("error", (error) => {
  console.error("MongoDB connection error:", error.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected.");
});

const blogSchema = new mongoose.Schema(
  {
    newTitle: {
      type: String,
      required: true,
      trim: true,
    },
    newContent: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: String,
      required: true,
      trim: true,
    },
    likes: {
      type: Number,
      default: 0,
      min: 0,
    },
    likedByUserIds: {
      type: [String],
      default: [],
    },
    likedByEmails: {
      type: [String],
      default: [],
    },
    authorId: {
      type: String,
      trim: true,
      default: "",
    },
    authorName: {
      type: String,
      trim: true,
      default: "Editorial Guest",
    },
    authorEmail: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const Blog = mongoose.model("Blog", blogSchema);

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function validateBlogPayload(req, res, next) {
  const { newTitle, newContent } = req.body;

  if (!newTitle?.trim() || !newContent?.trim()) {
    return res.status(400).json({
      message: "Title and content are required.",
    });
  }

  next();
}

function validateSignedInUser(req, res, next) {
  const { authorId, authorName, authorEmail } = req.body;

  if (!authorId?.trim() || !authorName?.trim() || !authorEmail?.trim()) {
    return res.status(401).json({
      message: "You must be signed in to manage blogs.",
    });
  }

  next();
}

function isAuthorizedBlogOwner(existingBlog, authorId, authorName) {
  const trimmedAuthorId = authorId?.trim();
  const trimmedAuthorName = authorName?.trim().toLowerCase();
  const existingAuthorId = existingBlog.authorId?.trim();
  const existingAuthorName = existingBlog.authorName?.trim().toLowerCase();

  if (trimmedAuthorId === ADMIN_UID) {
    return true;
  }

  if (existingAuthorId && trimmedAuthorId && existingAuthorId === trimmedAuthorId) {
    return true;
  }

  if (!existingAuthorId && existingAuthorName && trimmedAuthorName && existingAuthorName === trimmedAuthorName) {
    return true;
  }

  return false;
}

function toBlogResponse(blog, userId = "", userEmail = "") {
  const likedByUserIds = Array.isArray(blog.likedByUserIds) ? blog.likedByUserIds : [];
  const likedByEmails = Array.isArray(blog.likedByEmails) ? blog.likedByEmails : [];
  const normalizedUserId = userId.trim();
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  const likedByCurrentUser =
    (normalizedUserId && likedByUserIds.includes(normalizedUserId)) ||
    (normalizedUserEmail && likedByEmails.includes(normalizedUserEmail));

  const blogObject = blog.toObject ? blog.toObject() : blog;

  return {
    ...blogObject,
    likedByUserIds,
    likedByEmails,
    likedByCurrentUser,
  };
}

function normalizeLikeIdentity(req) {
  return {
    authorId: req.body.authorId?.trim() || "",
    authorEmail: req.body.authorEmail?.trim().toLowerCase() || "",
  };
}

function hasUserLikedBlog(blog, authorId, authorEmail) {
  const likedByUserIds = Array.isArray(blog.likedByUserIds) ? blog.likedByUserIds : [];
  const likedByEmails = Array.isArray(blog.likedByEmails) ? blog.likedByEmails : [];

  return likedByUserIds.includes(authorId) || likedByEmails.includes(authorEmail);
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Blog backend is running.",
  });
});

app.get("/api/health", (req, res) => {
  const hasMongoUri = Boolean(MONGODB_URI);

  res.json({
    status: mongoose.connection.readyState === 1 && hasMongoUri ? "ok" : "degraded",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    mongoConfigured: hasMongoUri,
  });
});

app.get("/api/blogs", async (req, res) => {
  try {
    const userId = req.query.userId?.trim() || "";
    const userEmail = req.query.userEmail?.trim().toLowerCase() || "";
    const blogs = await Blog.find({}).sort({ createdAt: -1 });
    res.json(blogs.map((blog) => toBlogResponse(blog, userId, userEmail)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/blogs", validateSignedInUser, validateBlogPayload, async (req, res) => {
  try {
    const blog = await Blog.create({
      newTitle: req.body.newTitle.trim(),
      newContent: req.body.newContent.trim(),
      date: req.body.date?.trim() || new Date().toLocaleDateString("en-US"),
      likes: Number.isFinite(req.body.likes) ? req.body.likes : 0,
      authorId: req.body.authorId.trim(),
      authorName: req.body.authorName.trim(),
      authorEmail: req.body.authorEmail.trim(),
    });

    res.status(201).json(blog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.put("/api/blogs/:id", validateSignedInUser, validateBlogPayload, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid blog id." });
    }

    const existingBlog = await Blog.findById(req.params.id);

    if (!existingBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    if (!isAuthorizedBlogOwner(existingBlog, req.body.authorId, req.body.authorName)) {
      return res.status(403).json({ message: "You can only edit your own blogs unless you are the admin." });
    }

    existingBlog.newTitle = req.body.newTitle.trim();
    existingBlog.newContent = req.body.newContent.trim();

    if (req.body.authorId.trim() === ADMIN_UID) {
      existingBlog.authorName = req.body.authorName.trim();
      existingBlog.authorId = req.body.authorId.trim();
      existingBlog.authorEmail = req.body.authorEmail.trim();
    }

    const updatedBlog = await existingBlog.save();
    res.json(updatedBlog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.patch("/api/blogs/like/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid blog id." });
    }

    const { authorId, authorEmail } = normalizeLikeIdentity(req);

    if (!authorId || !authorEmail) {
      return res.status(401).json({ message: "Please sign in to like a blog." });
    }

    const existingBlog = await Blog.findById(req.params.id);

    if (!existingBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    const alreadyLiked = hasUserLikedBlog(existingBlog, authorId, authorEmail);
    const update = alreadyLiked
      ? {
          $inc: { likes: -1 },
          $pull: {
            likedByUserIds: authorId,
            likedByEmails: authorEmail,
          },
        }
      : {
          $inc: { likes: 1 },
          $addToSet: {
            likedByUserIds: authorId,
            likedByEmails: authorEmail,
          },
        };

    const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    if (!updatedBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    if (updatedBlog.likes < 0) {
      updatedBlog.likes = 0;
      await updatedBlog.save();
    }

    res.json({
      blog: toBlogResponse(updatedBlog, authorId, authorEmail),
      liked: !alreadyLiked,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch("/api/blogs/unlike/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid blog id." });
    }

    const { authorId, authorEmail } = normalizeLikeIdentity(req);

    if (!authorId || !authorEmail) {
      return res.status(401).json({ message: "Please sign in to unlike a blog." });
    }

    const existingBlog = await Blog.findById(req.params.id);

    if (!existingBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    const likedByUserIds = Array.isArray(existingBlog.likedByUserIds) ? existingBlog.likedByUserIds : [];
    const likedByEmails = Array.isArray(existingBlog.likedByEmails) ? existingBlog.likedByEmails : [];

    if (!likedByUserIds.includes(authorId) && !likedByEmails.includes(authorEmail)) {
      return res.status(409).json({
        message: "You have not liked this blog yet.",
        blog: toBlogResponse(existingBlog, authorId, authorEmail),
        liked: false,
      });
    }

    const updatedBlog = await Blog.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { likedByUserIds: authorId },
          { likedByEmails: authorEmail },
        ],
      },
      {
        $inc: { likes: -1 },
        $pull: {
          likedByUserIds: authorId,
          likedByEmails: authorEmail,
        },
      },
      {
        new: true,
      }
    );

    if (!updatedBlog) {
      const currentBlog = await Blog.findById(req.params.id);

      return res.status(409).json({
        message: "You have not liked this blog yet.",
        blog: currentBlog ? toBlogResponse(currentBlog, authorId, authorEmail) : null,
        liked: false,
      });
    }

    if (updatedBlog.likes < 0) {
      updatedBlog.likes = 0;
      await updatedBlog.save();
    }

    res.json({
      blog: toBlogResponse(updatedBlog, authorId, authorEmail),
      liked: false,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/blogs/:id", validateSignedInUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid blog id." });
    }

    const existingBlog = await Blog.findById(req.params.id);

    if (!existingBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    if (!isAuthorizedBlogOwner(existingBlog, req.body.authorId, req.body.authorName)) {
      return res.status(403).json({ message: "You can only delete your own blogs unless you are the admin." });
    }

    await Blog.findByIdAndDelete(req.params.id);
    res.json({ message: "Blog deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function connectToMongoWithRetry() {
  if (!MONGODB_URI) {
    console.error("MongoDB connection skipped: MONGODB_URI is not configured.");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connection established.");
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    console.log(`Retrying MongoDB connection in ${MONGO_RETRY_DELAY_MS / 1000} seconds...`);

    setTimeout(connectToMongoWithRetry, MONGO_RETRY_DELAY_MS);
  }
}

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing process or start this server with a different PORT value.`);
    process.exit(1);
  }

  console.error("Server failed to start:", error.message);
  process.exit(1);
});

connectToMongoWithRetry();
