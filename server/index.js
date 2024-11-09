require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const cors = require("cors");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
// const googleAuth = require('./routes/googleAuth');
const passport = require("./middleware/passport-setup");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const router = express.Router();
const path = require("path");
const fs = require("fs");

const { isAuthenticated, hasAdminRole } = require("./middleware/auth");
const multer = require("multer");
const app = express();
app.use(cookieParser());
const allowedOrigins = ["http://localhost:3000", "http://localhost:3001"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Check if the request origin is in the allowedOrigins array
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Untuk mengizinkan penggunaan cookie
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// MySQL connection setup
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "lalajoeuydb",
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
    return;
  }
  console.log("Connected to MySQL!");
});

app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "Strict", // or "Lax" or "None" based on your requirements
      secure: process.env.NODE_ENV === "production", // Set to true if using HTTPS
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "_" + Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
});

// Logout route
app.get("/logout", (req, res) => {
  req.logout();
  res.redirect("/");
});

app.get("/movies/movie", (req, res) => {
  const {
    page = 1,
    limit = 10,
    yearRange,
    genre,
    status,
    availability,
    country_release,
    sort,
    awards,
  } = req.query;
  const offset = (page - 1) * limit;

  let filterConditions = [];
  let queryParams = [];

  // Handle year range filtering
  if (yearRange) {
    try {
      const range = JSON.parse(yearRange); // Parse the incoming JSON string
      queryParams.push(range.start, range.end); // Push start and end years to params
      filterConditions.push(`m.release_year BETWEEN ? AND ?`);
    } catch (error) {
      console.error("Error parsing yearRange:", error);
      return res.status(400).json({ error: "Invalid yearRange format" });
    }
  }

  if (req.query.search) {
    filterConditions.push(`m.title LIKE ?`);
    queryParams.push(`%${req.query.search}%`); // Use wildcards for searching
  }

  if (awards) {
    filterConditions.push(`a.awards_name = ?`);
    queryParams.push(awards);
  }

  if (status) {
    filterConditions.push(`s.name = ?`);
    queryParams.push(status);
  }

  if (availability) {
    filterConditions.push(`av.platform_name = ?`);
    queryParams.push(availability);
  }
  if (country_release) {
    filterConditions.push(`c.country_name = ?`);
    queryParams.push(country_release);
  }

  // Main query to fetch movies and genres
  let query = ` 
    SELECT m.id, m.title, m.poster AS src, m.release_year AS year, 
           GROUP_CONCAT(DISTINCT g.name SEPARATOR ', ') AS genres, 
           m.imdb_score AS rating, m.view, c.country_name AS country, a.awards_name AS awards, s.name AS status, av.platform_name AS availability
    FROM movies m
    JOIN movie_genres mg ON m.id = mg.movie_id
    JOIN genres g ON mg.genre_id = g.id
    JOIN movie_countries mc ON m.id = mc.movie_id
    JOIN countries c ON mc.country_id = c.id
    JOIN movie_awards ma ON m.id = ma.movie_id
    JOIN awards a ON ma.awards_id = a.id
    JOIN status s ON m.status_id = s.id
    JOIN availability av ON m.availability_id = av.id
    WHERE status = 1
  `;

  // Apply filters
  if (filterConditions.length) {
    query += ` AND ${filterConditions.join(" AND ")}`;
  }

  // Handle genre filtering
  if (genre && genre.trim()) {
    query += ` AND m.id IN (
      SELECT mg.movie_id 
      FROM movie_genres mg 
      JOIN genres g ON mg.genre_id = g.id 
      WHERE g.name = ?
    )`;
    queryParams.push(genre);
  }

  query += ` GROUP BY m.id`;

  if (sort) {
    query += ` ORDER BY m.title ${sort.toUpperCase()}`;
  } else {
    query += ` ORDER BY m.id`;
  }

  // Add pagination limits
  query += ` LIMIT ? OFFSET ?`;
  queryParams.push(parseInt(limit), parseInt(offset));

  // Execute the main movie query
  db.query(query, queryParams, (err, results) => {
    if (err) {
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    // Slice off LIMIT and OFFSET for the COUNT query
    const countQueryParams = queryParams.slice(0, -2);

    // Count query to get the total number of filtered movies
    let countQuery = ` 
      SELECT COUNT(DISTINCT m.id) AS totalCount 
      FROM movies m
      JOIN movie_genres mg ON m.id = mg.movie_id
      JOIN genres g ON mg.genre_id = g.id
      JOIN movie_countries mc ON m.id = mc.movie_id
      JOIN countries c ON mc.country_id = c.id
      JOIN movie_awards ma ON m.id = ma.movie_id
      JOIN awards a ON ma.awards_id = a.id
      JOIN status s ON m.status_id = s.id 
      JOIN availability av ON m.availability_id = av.id
      WHERE status = 1
    `;

    // Apply filters to count query as well
    if (filterConditions.length) {
      countQuery += ` AND ${filterConditions.join(" AND ")}`;
    }

    if (genre && genre.trim()) {
      countQuery += ` AND m.id IN (
        SELECT mg.movie_id 
        FROM movie_genres mg 
        JOIN genres g ON mg.genre_id = g.id 
        WHERE g.name = ?
      )`;
    }

    // Execute the count query with the correct parameters
    db.query(countQuery, countQueryParams, (countErr, countResults) => {
      if (countErr) {
        res.status(500).json({ error: "Failed to get movie count" });
        return;
      }

      const totalCount = countResults[0].totalCount;
      res.json({
        movies: results,
        totalCount,
      });
    });
  });
});

// Rute baru untuk mengambil availability/platforms dari database
app.get("/platforms", (req, res) => {
  const query = `
    SELECT id, platform_name 
    FROM availability
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching availability data:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch availability data" });
    }

    res.json(results); // Mengirimkan hasil dalam bentuk JSON
  });
});

app.get("/search", (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).send("Search query is required");
  }

  // Use MySQL LIKE to find matches in the title or description and join with genres
  const sql = `
    SELECT m.id, m.title, m.poster, m.release_year, m.imdb_score, 
           GROUP_CONCAT(g.name SEPARATOR ', ') AS genres, m.view
    FROM movies m
    JOIN movie_genres mg ON m.id = mg.movie_id
    JOIN genres g ON mg.genre_id = g.id
    WHERE m.title LIKE ?
    GROUP BY m.id
    LIMIT 10
  `;
  const searchTerm = `%${query}%`;

  db.query(sql, [searchTerm], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.get("/movies/detail/:id", (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT
      movies.id AS movie_id,
      movies.title,
      movies.alt_title,
      countries.id AS country_id,
      countries.country_name,
      movies.release_year,
      movies.imdb_score,
      movies.synopsis,
      movies.view,
      movies.poster,
      movies.background,
      movies.trailer,
      movies.director,
      actors.id AS actor_id,
      actors.name AS actor_name,
      actors.actor_picture,
      movie_actors.role,
      genres.id AS genre_id,
      genres.name AS genre_name,
      awards.id AS awards_id,
      awards.awards_name,
      availability.platform_name AS availability_platform_name,
      status.name AS status_name
    FROM
      movies
    LEFT JOIN
      movie_actors ON movies.id = movie_actors.movie_id
    LEFT JOIN
      actors ON movie_actors.actor_id = actors.id
    LEFT JOIN
      movie_genres ON movies.id = movie_genres.movie_id
    LEFT JOIN
      genres ON movie_genres.genre_id = genres.id
    LEFT JOIN 
      movie_countries ON movies.id = movie_countries.movie_id
    LEFT JOIN
      countries ON movie_countries.country_id = countries.id
    LEFT JOIN 
      movie_awards ON movies.id = movie_awards.movie_id
    LEFT JOIN
      awards ON movie_awards.awards_id = awards.id
    LEFT JOIN
    availability ON movies.availability_id = availability.id 
    LEFT JOIN
    status ON movies.status_id = status.id
    WHERE
      movies.id = ? AND status = 1
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    // Process results to structure them
    const movie = {
      id: results[0].movie_id,
      title: results[0].title,
      alt_title: results[0].alt_title,
      release_year: results[0].release_year,
      imdb_score: results[0].imdb_score,
      synopsis: results[0].synopsis,
      view: results[0].view,
      poster: results[0].poster,
      background: results[0].background,
      trailer: results[0].trailer,
      director: results[0].director,
      genre: [],
      countries: [],
      actors: [],
      awards: [],
      availability: results[0].availability_platform_name,
      status: results[0].status_name,
    };

    const genreMap = new Map();
    const countryMap = new Map(); // Added for country
    const actorMap = new Map();
    const awardMap = new Map();

    results.forEach((row) => {
      // Handle genres
      if (row.genre_id && !genreMap.has(row.genre_id)) {
        genreMap.set(row.genre_id, {
          id: row.genre_id,
          name: row.genre_name,
        });
      }

      // Handle countries (many-to-many)
      if (row.country_id && !countryMap.has(row.country_id)) {
        countryMap.set(row.country_id, {
          id: row.country_id,
          name: row.country_name,
        });
      }

      // Handle actors
      if (row.actor_id && !actorMap.has(row.actor_id)) {
        actorMap.set(row.actor_id, {
          id: row.actor_id,
          name: row.actor_name,
          role: row.role,
          actor_picture: row.actor_picture,
        });
      }

      // Handle awards
      if (row.awards_id && !awardMap.has(row.awards_id)) {
        awardMap.set(row.awards_id, {
          id: row.awards_id,
          name: row.awards_name,
        });
      }
    });

    movie.genre = Array.from(genreMap.values());
    movie.countries = Array.from(countryMap.values()); // Added for country
    movie.actors = Array.from(actorMap.values());
    movie.awards = Array.from(awardMap.values());

    res.json(movie);
  });
});

//fetch movie review
app.get("/movies/detail/review/:id", (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT
      reviews.id AS review_id,
      users.id AS user_id,
      users.username AS user_name,
      users.profile_picture AS user_picture,
      reviews.content,
      reviews.rating,
      reviews.created_at
    FROM
      reviews
    JOIN
      users ON users.id = reviews.user_id
    WHERE
      reviews.movie_id = ? AND reviews.status = 1 AND reviews.deleted_at IS NULL
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    res.json(results);
  });
});

//fetch all filter criteria

app.get('/filters', async (req, res) => {
  const queries = {
    years: 'SELECT MIN(release_year) AS minYear, MAX(release_year) AS maxYear FROM movies',
    genres: 'SELECT id, name FROM genres ORDER BY name ASC',
    awards: 'SELECT id, awards_name FROM awards ORDER BY awards_name ASC',
    countries: 'SELECT id, country_name FROM countries ORDER BY country_name ASC',
    availability: 'SELECT id, platform_name FROM availability ORDER BY platform_name ASC',
    status: 'SELECT id, name FROM status ORDER BY name ASC',
  };

  const results = {};

  try {
    // Fetch years first to calculate decades
    const [yearRows] = await db.promise().query(queries.years);
    
    if (yearRows.length) {
      const minYear = yearRows[0].minYear;
      const maxYear = yearRows[0].maxYear;
      
     
      const different = minYear % 10;
      const normalizedMinYear = minYear - different; 
      const decades = [];

      for (let year = normalizedMinYear; year <= maxYear; year += 10) {
        decades.push({
          start: year,
          end: year + 10, 
        });
      }

      results.years = decades; 
    } else {
      results.years = [];
    }

    // Fetch genres
    const [genreRows] = await db.promise().query(queries.genres);
    results.genres = genreRows.map(row => ({
      id: row.id,
      name: row.name,
    }));

    // Fetch awards
    const [awardRows] = await db.promise().query(queries.awards);
    results.awards = awardRows.map(row => ({
      id: row.id,
      name: row.awards_name,
    }));

    // Fetch countries
    const [countryRows] = await db.promise().query(queries.countries);
    results.countries = countryRows.map(row => ({
      id: row.id,
      name: row.country_name,
    }));

    // Fetch availability
    const [availabilityRows] = await db.promise().query(queries.availability);
    results.availability = availabilityRows.map(row => ({
      id: row.id,
      name: row.platform_name,
    }));

    // Fetch status
    const [statusRows] = await db.promise().query(queries.status);
    results.status = statusRows.map(row => ({
      id: row.id,
      name: row.name,
    }));

    res.json(results); 
  } catch (error) {
    console.error('Error fetching filters:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch top 10 highest-rated movies
app.get("/top-rated", (req, res) => {
  const query =
    "SELECT title, background, imdb_score FROM movies WHERE id BETWEEN 1 AND 500 ORDER BY imdb_score DESC LIMIT 15";

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results); // Send the top 10 movies to the front-end
  });
});

app.get("/featured", (req, res) => {
  const query =
    "SELECT id, title, background, poster, imdb_score, synopsis FROM movies WHERE release_year=2024 ORDER BY imdb_score DESC LIMIT 10";

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }

    res.json(results); // Send the top 10 movies to the front-end
  });
});

//CMS
app.get("/dashboard", (req, res) => {
  const queryMovies = "SELECT COUNT(*) AS movieCount FROM movies";
  const queryGenres = "SELECT COUNT(*) AS genreCount FROM genres";
  const queryCountries = "SELECT COUNT(*) AS countryCount FROM countries";
  const queryAwards = "SELECT COUNT(*) AS awardCount FROM awards";

  const getMoviesCount = () =>
    new Promise((resolve, reject) => {
      db.query(queryMovies, (err, results) => {
        if (err) reject(err);
        else resolve(results[0].movieCount);
      });
    });

  const getGenresCount = () =>
    new Promise((resolve, reject) => {
      db.query(queryGenres, (err, results) => {
        if (err) reject(err);
        else resolve(results[0].genreCount);
      });
    });

  const getCountriesCount = () =>
    new Promise((resolve, reject) => {
      db.query(queryCountries, (err, results) => {
        if (err) reject(err);
        else resolve(results[0].countryCount);
      });
    });

  const getAwardsCount = () =>
    new Promise((resolve, reject) => {
      db.query(queryAwards, (err, results) => {
        if (err) reject(err);
        else resolve(results[0].awardCount);
      });
    });

  // Run all queries in parallel and return the response
  Promise.all([
    getMoviesCount(),
    getGenresCount(),
    getCountriesCount(),
    getAwardsCount(),
  ])
    .then(([movieCount, genreCount, countryCount, awardCount]) => {
      const response = {
        movieCount,
        genreCount,
        countryCount,
        awardCount,
      };
      res.json(response);
    })
    .catch((err) => {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    });
});

app.get("/movie-genre-count-by-decade", (req, res) => {
  const query = `
    SELECT 
      FLOOR(YEAR(m.release_year) / 10) * 10 AS decade,  -- Mengelompokkan berdasarkan dekade
      COUNT(DISTINCT m.id) AS movieCount, 
      COUNT(DISTINCT mg.genre_id) AS genreCount
    FROM movies m
    LEFT JOIN movie_genres mg ON m.id = mg.movie_id
    GROUP BY decade
    ORDER BY decade ASC;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    } else {
      res.json(results);
    }
  });
});

app.get("/movie-list", isAuthenticated, hasAdminRole, (req, res) => {
  const { status } = req.query; // Ambil query parameter status dari request

  let query = `
    SELECT
    m.status, 
    m.id, 
    m.title,
    m.imdb_score,
    m.alt_title,
    m.director,
    m.poster, 
    m.background,
    m.view,
    m.trailer,
    m.release_year,
    GROUP_CONCAT(DISTINCT CONCAT(ac.name, ' (', mac.role, ')') SEPARATOR ', ') AS Actors,
    GROUP_CONCAT(DISTINCT g.name SEPARATOR ', ') AS Genres,
    GROUP_CONCAT(DISTINCT c.country_name SEPARATOR ', ') AS Countries,
    GROUP_CONCAT(DISTINCT a.awards_name SEPARATOR ', ') AS Awards,
    m.synopsis,
    m.availability_id,
    m.status_id
FROM movies m
JOIN movie_actors mac ON mac.movie_id = m.id
JOIN actors ac ON ac.id = mac.actor_id
JOIN movie_genres mg ON mg.movie_id = m.id
JOIN genres g ON g.id = mg.genre_id
JOIN status s ON s.id = m.status_id
JOIN availability av ON av.id = m.availability_id
JOIN movie_countries mc ON mc.movie_id = m.id
JOIN countries c ON c.id = mc.country_id
JOIN movie_awards ma ON ma.movie_id = m.id
JOIN awards a ON a.id = ma.awards_id
    `;

  // Tambahkan filter berdasarkan status jika parameter status ada
  if (status) {
    query += ` WHERE m.status = ${db.escape(status)}`; // Escape parameter status untuk menghindari SQL injection
  }

  query += ` GROUP BY m.id`;

  // Eksekusi query dan kirim hasil ke frontend
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});


// app.get("/users",  isAuthenticated, hasAdminRole, (req, res) => {
app.get("/users", isAuthenticated, hasAdminRole, (req, res) => {
  const query = `
    SELECT id, username, role, email, Status_Account FROM users WHERE Status_Account != 3
  `;

  // Eksekusi query dan kirim hasil ke frontend
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// POST endpoint untuk menambah user baru
app.post("/users",isAuthenticated, hasAdminRole, async (req, res) => {
  const { username, email, password, profile_picture, role } = req.body;

  // Validasi input
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Hash password sebelum menyimpan ke database
    const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds = 10

    // Query untuk menambahkan user baru
    const query = `
      INSERT INTO users (username, email, password, role, Status_Account)
      VALUES (?, ?, ?, ?, 1)
    `;
    // Menggunakan password yang sudah di-hash untuk disimpan
    const [result] = await db.query(query, [
      username,
      email,
      hashedPassword,
      profile_picture,
      role,
    ]);

    // Mengembalikan response user yang baru ditambahkan tanpa menampilkan password
    res.status(200).json({ id: result.insertId, username, email, role });
  } catch (err) {
    console.error("Error executing query:", err.message);
    return res.status(500).json({ error: "Failed to add user" });
  }
});

// PUT endpoint untuk mengupdate user yang sudah ada
app.put("/users/:id", isAuthenticated, hasAdminRole, async (req, res) => {
  const { id } = req.params;
  const { username, email, role, profile_picture, password } = req.body;

  // Validasi input
  if (!username || !email || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const query = `
    UPDATE users
    SET username = ?, email = ?, role = ?, profile_picture = ?, password = ?
    WHERE id = ?
  `;

  try {
    await db.query(query, [
      username,
      email,
      role,
      profile_picture,
      password,
      id,
    ]);
    res.status(200).json({ message: "User updated successfully" });
  } catch (err) {
    console.error("Error executing query:", err.message);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE endpoint untuk menghapus user
app.delete("/users/:id", isAuthenticated, hasAdminRole, async (req, res) => {
  const userId = req.params.id;

  try {
    // Update nilai Status_Account menjadi 3
    const query = `UPDATE users SET Status_Account = 3 WHERE id = ?`;
    await db.query(query, [userId]);

    res.status(200).json({ message: "User suspended successfully" });
  } catch (err) {
    console.error("Error executing query:", err.message);
    res.status(500).json({ error: "Failed to update user status" });
  }
});

// Endpoint untuk menangguhkan user (Status_Account = 2)
app.put("/users/suspend/:id", isAuthenticated, hasAdminRole, async (req, res) => {
  const userId = req.params.id;

  try {
    // Update Status_Account to 2 (suspended)
    const query = `UPDATE users SET Status_Account = 2 WHERE id = ?`;

    // Use .promise() to return a promise from the query
    const [result] = await db.promise().query(query, [userId]);

    // Check if any rows were affected
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    res.status(200).json({ message: "User suspended successfully" });
  } catch (err) {
    console.error("Error executing query:", err.message);
    res.status(500).json({ error: "Failed to suspend user" });
  }
});

app.put("/users/unlock/:id", isAuthenticated, hasAdminRole, async (req, res) => {
  const userId = req.params.id;

  try {
    // Update Status_Account to 1 (unlocked)
    const query = `UPDATE users SET Status_Account = 1 WHERE id = ?`;

    // Use .promise() to return a promise from the query
    const [result] = await db.promise().query(query, [userId]);

    // Check if any rows were affected
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    res.status(200).json({ message: "User unlocked successfully" });
  } catch (err) {
    console.error("Error executing query:", err.message);
    res.status(500).json({ error: "Failed to unlock user" });
  }
});


// Route to fetch all actors
app.get("/actors", (req, res) => {
  const query = `
    SELECT 
      a.id, 
      a.name, 
      a.birthdate, 
      c.country_name, 
      a.actor_picture 
    FROM 
      actors a
    JOIN 
      countries c
    ON 
      a.country_birth_id = c.id
    WHERE 
      a.deleted_at IS NULL
    ORDER BY 
      a.id ASC;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// Route to add a new actor
app.post("/actors", isAuthenticated, hasAdminRole, (req, res) => {
  const { name, birthdate, country_name, actor_picture } = req.body;
  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (!name || !birthdate || !country_name) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Check if the country exists in the database
    const checkCountryQuery = `
    SELECT id FROM countries WHERE country_name = ?;
  `;

    db.query(checkCountryQuery, [country_name], (err, countryResult) => {
      if (err) {
        console.error("Error checking country:", err.message);
        return res.status(500).json({ error: "Failed to check country." });
      }

      if (countryResult.length === 0) {
        // If country doesn't exist, return an error
        return res
          .status(400)
          .json({ error: "Country not found. Please add the country first." });
      }

      // If country exists, proceed with adding the actor
      const country_birth_id = countryResult[0].id;

      const addActorQuery = `
      INSERT INTO actors (name, birthdate, country_birth_id, actor_picture) 
      VALUES (?, ?, ?, ?);
    `;
      const values = [name, birthdate, country_birth_id, actor_picture];

      db.query(addActorQuery, values, (err, result) => {
        if (err) {
          console.error("Error inserting actor:", err.message);
          return res.status(500).json({ error: "Failed to add actor." });
        }
        // Commit the transaction if the update succeeds
        db.commit((err) => {
          if (err) {
            console.error("Error committing transaction:", err);
            return db.rollback(() => {
              res.status(500).json({ error: "Internal Server Error" });
            });
          }
          res
            .status(201)
            .json({ message: "Actor added successfully.", id: result.insertId });

        });
      });
    });
  });
});


// Route to update an existing actor with country existence check
app.put("/actors/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;
  const { name, birthdate, country_name, actor_picture } = req.body;

  if (!name || !birthdate || !country_name) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Check if country exists before updating actor
  const checkCountryQuery = "SELECT id FROM countries WHERE country_name = ?";
  db.query(checkCountryQuery, [country_name], (err, countryResult) => {
    if (err) {
      console.error("Error checking country existence:", err.message);
      return res
        .status(500)
        .json({ error: "Failed to check country existence." });
    }

    if (countryResult.length === 0) {
      return res.status(400).json({ error: "Country does not exist." });
    }

    // If country exists, proceed to update actor
    const country_birth_id = countryResult[0].id;

    const updateQuery = `
      UPDATE actors 
      SET name = ?, birthdate = ?, country_birth_id = ?, actor_picture = ?
      WHERE id = ?;
    `;
    const values = [name, birthdate, country_birth_id, actor_picture, id];

    db.query(updateQuery, values, (err, result) => {
      if (err) {
        console.error("Error updating actor:", err.message);
        return res.status(500).json({ error: "Failed to update actor." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Actor not found." });
      }

      res.json({ message: "Actor updated successfully." });
    });
  });
});

// Route to delete an actor
app.put("/actors/delete/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  const query = `
    UPDATE actors SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?
  `;
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting actor:", err.message);
      return res.status(500).json({ error: "Failed to delete actor." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Actor not found." });
    }

    res.json({ message: "Actor deleted successfully." });
  });
});


// Get all genres
app.get("/genres", (req, res) => {
  const query = "SELECT id, name FROM genres WHERE deleted_at IS NULL ORDER BY id ASC ";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// Add a new genre
app.post("/genres", isAuthenticated, hasAdminRole, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Genre name is required" });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = "INSERT INTO genres (name) VALUES (?)";
    db.query(query, [name], (err, result) => {
      if (err) {
        console.error("Error adding genre:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to add genre" });
        });
      }

      // Commit the transaction if the query succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ id: result.insertId, name });
      });
    });
  });
});

// Update an existing genre
app.put("/genres/update/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (!name) {
      return res.status(400).json({ error: "Genre name is required" });
    }

    const query = "UPDATE genres SET name = ? WHERE id = ?";
    db.query(query, [name, id], (err) => {
      if (err) {
        console.error("Error updating genre:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to update genre" });
        });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Genre updated successfully" });
      });
    });
  });
});

// Delete a genre
app.put("/genres/delete/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = `
      UPDATE genres SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?
    `;
    db.query(query, [id], (err) => {
      if (err) {
        console.error("Error deleting genre:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to delete genre" });
        });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Genre deleted successfully" });
      });
    });
  });
});

// Get all countries
app.get("/countries", isAuthenticated, hasAdminRole,(req, res) => {
  const query = "SELECT id, country_name FROM countries WHERE deleted_at IS NULL ORDER BY id ASC ";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// Get a single country berdasarkan country_name
app.get(
  "/countries/:country_name",

  (req, res) => {
    const { country_name } = req.params;
    const query =
      "SELECT id, country_name FROM countries WHERE country_name = ?";
    db.query(query, [country_name], (err, results) => {
      if (err) {
        console.error("Error executing query:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
        return;
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Country not found" });
      }

      res.json(results[0]);
    });
  }
);

// Add a new country
app.post("/countries", isAuthenticated, hasAdminRole, (req, res) => {
  const { country_name } = req.body;
  if (!country_name) {
    return res.status(400).json({ error: "Country name is required" });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = "INSERT INTO countries (country_name) VALUES (?)";
    db.query(query, [country_name], (err, result) => {
      if (err) {
        console.error("Error adding country:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to add country" });
        });
      }

      // Commit the transaction if the query succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ id: result.insertId, country_name });
      });
    });
  });
});

// Update an existing country
app.put("/countries/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;
  const { country_name } = req.body;

  if (!country_name) {
    return res.status(400).json({ error: "Country name is required" });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = "UPDATE countries SET country_name = ? WHERE id = ?";
    db.query(query, [country_name, id], (err) => {
      if (err) {
        console.error("Error updating country:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to update country" });
        });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Country updated successfully" });
      });
    });
  });
});

// Delete a country
app.put("/countries/delete/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = `
      UPDATE countries SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?;
    `;

    db.query(query, [id], (err, result) => {
      if (err) {
        console.error("Error deleting country:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to delete country" });
        });
      }

      if (result.affectedRows === 0) {
        return db.rollback(() => {
          res.status(404).json({ error: "Country not found" });
        });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Country deleted successfully" });
      });
    });
  });
});

// Get all awards
app.get("/awards", isAuthenticated, hasAdminRole, (req, res) => {
  const query = `
    SELECT 
      a.id, 
      a.awards_name, 
      c.country_name,
      a.awards_years
    FROM 
      awards a 
    JOIN 
      countries c 
    ON 
      a.country_id = c.id 
    WHERE
      a.deleted_at IS NULL
    ORDER BY 
      a.id ASC;
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// Route to add a new Award
app.post("/awards", isAuthenticated, hasAdminRole, (req, res) => {
  const { awards_name, country_name, awards_years } = req.body;

  if (!awards_name || !country_name || !awards_years) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Check if the country exists in the database
    const checkCountryQuery = `SELECT id FROM countries WHERE country_name = ?`;

    db.query(checkCountryQuery, [country_name], (err, countryResult) => {
      if (err) {
        console.error("Error checking country:", err);
        return db.rollback(() => {
          res.status(500).json({ error: "Internal Server Error" });
        });
      }

      if (countryResult.length === 0) {
        return db.rollback(() => {
          res.status(404).json({ error: "Country not found." });
        });
      }

      // If country exists, proceed with adding the award
      const country_id = countryResult[0].id;

      const addAwardQuery = `
        INSERT INTO awards (awards_name, country_id, awards_years) 
        VALUES (?, ?, ?);
      `;
      const values = [awards_name, country_id, awards_years];

      db.query(addAwardQuery, values, (err, result) => {
        if (err) {
          console.error("Error adding award:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        // Commit the transaction if all queries succeed
        db.commit((err) => {
          if (err) {
            console.error("Error committing transaction:", err);
            return db.rollback(() => {
              res.status(500).json({ error: "Internal Server Error" });
            });
          }

          res.status(201).json({ message: "Award added successfully!" });
        });
      });
    });
  });
});

// Route to update an existing award with country existence check
app.put("/awards/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;
  const { awards_name, country_name, awards_years } = req.body;

  if (!awards_name || !country_name || !awards_years) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Check if country exists before updating award
    const checkCountryQuery = "SELECT id FROM countries WHERE country_name = ?";
    db.query(checkCountryQuery, [country_name], (err, countryResult) => {
      if (err) {
        console.error("Error checking country existence:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to check country existence." });
        });
      }

      if (countryResult.length === 0) {
        return db.rollback(() => {
          res.status(400).json({ error: "Country does not exist." });
        });
      }

      // If country exists, proceed with updating the award
      const country_id = countryResult[0].id;

      const updateQuery = `
        UPDATE awards 
        SET awards_name = ?, country_id = ?, awards_years = ?
        WHERE id = ?;
      `;
      const values = [awards_name, country_id, awards_years, id];

      db.query(updateQuery, values, (err, result) => {
        if (err) {
          console.error("Error updating award:", err.message);
          return db.rollback(() => {
            res.status(500).json({ error: "Failed to update award." });
          });
        }

        if (result.affectedRows === 0) {
          return db.rollback(() => {
            res.status(404).json({ error: "Award not found." });
          });
        }

        // Commit the transaction if all queries succeed
        db.commit((err) => {
          if (err) {
            console.error("Error committing transaction:", err);
            return db.rollback(() => {
              res.status(500).json({ error: "Internal Server Error" });
            });
          }

          res.json({ message: "Award updated successfully." });
        });
      });
    });
  });
});
// Route to delete an award
app.delete("/awards/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = `
      UPDATE awards SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?;
    `;

    db.query(query, [id], (err, result) => {
      if (err) {
        console.error("Error deleting award:", err.message);
        return db.rollback(() => {
          res.status(500).json({ error: "Failed to delete award." });
        });
      }

      if (result.affectedRows === 0) {
        return db.rollback(() => {
          res.status(404).json({ error: "Award not found." });
        });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Award deleted successfully." });
      });
    });
  });
});

// route to fetch all reviews
app.get("/reviews", (req, res) => {
  const query = `
    SELECT 
      reviews.id AS review_id,
      reviews.content,
      reviews.rating,
      reviews.status,
      reviews.created_at,
      reviews.updated_at,
      movies.title AS movie_title,
      users.username AS user_name
    FROM 
      reviews
    JOIN 
      movies ON reviews.movie_id = movies.id
    JOIN 
      users ON reviews.user_id = users.id
    WHERE 
      reviews.deleted_at IS NULL
    ORDER BY reviews.id ASC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
    res.json(results);
  });
});

// Route to approve a review
app.put("/reviews/:id/approve", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = "UPDATE reviews SET status = 1 WHERE id = ?";
    db.query(query, [id], (err, result) => {
      if (err) {
        console.error("Error approving review:", err.message);
        return res.status(500).json({ error: "Failed to approve review." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Review not found." });
      }
      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }


        res.json({ message: "Review approved successfully." });
      });
    });
  });
});

// Route to soft-delete a review by updating the deleted_at column
app.put("/reviews/:id/soft-delete", isAuthenticated, hasAdminRole, (req, res) => {
  const { id } = req.params;

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error("Error starting transaction:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    const query = "UPDATE reviews SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.query(query, [id], (err, result) => {
      if (err) {
        console.error("Error updating deleted_at for review:", err.message);
        return res.status(500).json({ error: "Failed to soft-delete review." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Review not found." });
      }

      // Commit the transaction if the update succeeds
      db.commit((err) => {
        if (err) {
          console.error("Error committing transaction:", err);
          return db.rollback(() => {
            res.status(500).json({ error: "Internal Server Error" });
          });
        }

        res.json({ message: "Review soft-deleted successfully." });
      });
    });
  });
});


app.get("/status", (req, res) => {
  const query = `
    SELECT id, name
    FROM status
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching availability data:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch availability data" });
    }

    res.json(results); // Mengirimkan hasil dalam bentuk JSON
  });
});

//CRUD

//ADD MOVIES
app.post("/add-drama", isAuthenticated, async (req, res) => {
  const {
    imdb_score,
    status,
    view,
    title,
    alt_title,
    director,
    release_year,
    country,
    synopsis,
    availability,
    trailer,
    posterUrl,
    backgroundUrl,
  } = req.body;

  console.log(req.body);

  try {
    // Query to get `availability_id`
    const availabilityQuery = `SELECT id FROM availability WHERE platform_name = ?`;
    const [availabilityResult] = await db
      .promise()
      .query(availabilityQuery, [availability]);
    const availabilityId =
      availabilityResult.length > 0 ? availabilityResult[0].id : null;

    // Query to get `status_id`
    const statusQuery = `SELECT id FROM status WHERE name = ?`;
    const [statusResult] = await db.promise().query(statusQuery, [status]);
    const status_id = statusResult.length > 0 ? statusResult[0].id : null;

    // Insert into movies table
    const movieQuery = `
      INSERT INTO movies (title, alt_title, release_year, imdb_score, synopsis, view, poster, background, trailer, director, status, status_id, availability_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?)
    `;
    const movieValues = [
      title,
      alt_title,
      release_year,
      imdb_score,
      synopsis,
      view,
      posterUrl,
      backgroundUrl,
      trailer,
      director,
      status_id,
      availabilityId,
    ];

    const [movieResult] = await db.promise().query(movieQuery, movieValues);
    const movieId = movieResult.insertId;

    // Parse fields that might be arrays from strings (if needed)
    const genres =
      typeof req.body.genres === "string"
        ? req.body.genres.split(",")
        : req.body.genres;
    const actors =
      typeof req.body.actors === "string"
        ? req.body.actors.split(",")
        : req.body.actors;
    const awards =
      typeof req.body.awards === "string"
        ? req.body.awards.split(",")
        : req.body.awards;

    // Insert into movie_genres
    for (const genre of genres) {
      const genreQuery = `SELECT id FROM genres WHERE name = ?`;
      const [genreResult] = await db.promise().query(genreQuery, [genre]);
      const genreId = genreResult.length > 0 ? genreResult[0].id : null;

      if (genreId) {
        const movieGenreQuery = `INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)`;
        await db.promise().query(movieGenreQuery, [movieId, genreId]);
      }
    }

    // Insert into movie_actors with roles
    for (const actor of actors) {
      const actorQuery = `SELECT id FROM actors WHERE name = ?`;
      const [actorResult] = await db.promise().query(actorQuery, [actor.name]);
      const actorId = actorResult.length > 0 ? actorResult[0].id : null;

      if (actorId) {
        const movieActorQuery = `INSERT INTO movie_actors (movie_id, actor_id, role) VALUES (?, ?, ?)`;
        await db
          .promise()
          .query(movieActorQuery, [movieId, actorId, actor.role]);
      }
    }

    // Insert into movie_countries
    const countryQuery = `SELECT id FROM countries WHERE country_name = ?`;
    const [countryResult] = await db.promise().query(countryQuery, [country]);
    const countryId = countryResult.length > 0 ? countryResult[0].id : null;

    if (countryId) {
      const movieCountryQuery = `INSERT INTO movie_countries (movie_id, country_id) VALUES (?, ?)`;
      await db.promise().query(movieCountryQuery, [movieId, countryId]);
    }

    // Insert into movie_awards
    for (const award of awards) {
      const awardQuery = `SELECT id FROM awards WHERE awards_name = ?`;
      const [awardResult] = await db.promise().query(awardQuery, [award]);
      const awardId = awardResult.length > 0 ? awardResult[0].id : null;

      if (awardId) {
        const movieAwardQuery = `INSERT INTO movie_awards (movie_id, awards_id) VALUES (?, ?)`;
        await db.promise().query(movieAwardQuery, [movieId, awardId]);
      }
    }

    res.status(200).json({ message: "Drama added successfully", movieId });
  } catch (err) {
    console.error("Error executing query:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/update-drama", isAuthenticated, hasAdminRole, async (req, res) => {
  const {
    id,
    imdb_score,
    status,
    view,
    title,
    alt_title,
    director,
    release_year,
    country,
    synopsis,
    availability,
    trailer,
    posterUrl,
    backgroundUrl,
    genres,
    actors,
    awards,
  } = req.body;

  console.log(req.body);

  try {
    // Query to get `availability_id`
    const availabilityQuery = `SELECT id FROM availability WHERE platform_name = ?`;
    const [availabilityResult] = await db.promise().query(availabilityQuery, [availability]);
    const availabilityId = availabilityResult.length > 0 ? availabilityResult[0].id : null;

    // Query to get `status_id`
    const statusQuery = `SELECT id FROM status WHERE name = ?`;
    const [statusResult] = await db.promise().query(statusQuery, [status]);
    const status_id = statusResult.length > 0 ? statusResult[0].id : null;
    
    // Update movies table
    const movieQuery = `
      UPDATE movies
      SET title = ?, alt_title = ?, release_year = ?, imdb_score = ?, synopsis = ?, view = ?, poster = ?, background = ?, trailer = ?, director = ?, status = ?, status_id = ?, availability_id = ?
      WHERE id = ?
    `;
    const movieValues = [
      title,
      alt_title,
      release_year,
      imdb_score,
      synopsis,
      view,
      posterUrl,
      backgroundUrl,
      trailer,
      director,
      1,
      status_id,
      availabilityId,
      id, // ID film yang akan diperbarui
    ];

    await db.promise().query(movieQuery, movieValues);

    // // Hapus data genres, actors, countries, dan awards terkait sebelumnya
    // await db.promise().query(`DELETE FROM movie_genres WHERE movie_id = ?`, [id]);
    // await db.promise().query(`DELETE FROM movie_actors WHERE movie_id = ?`, [id]);
    // await db.promise().query(`DELETE FROM movie_countries WHERE movie_id = ?`, [id]);
    // await db.promise().query(`DELETE FROM movie_awards WHERE movie_id = ?`, [id]);

    // Insert genres
    for (const genre of genres) {
      const genreQuery = `SELECT id FROM genres WHERE name = ?`;
      const [genreResult] = await db.promise().query(genreQuery, [genre]);
      const genreId = genreResult.length > 0 ? genreResult[0].id : null;

      if (genreId) {
        const movieGenreQuery = `INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)`;
        await db.promise().query(movieGenreQuery, [id, genreId]);
      }
    }

    // Insert actors with roles
    for (const actor of actors) {
      const actorQuery = `SELECT id FROM actors WHERE name = ?`;
      const [actorResult] = await db.promise().query(actorQuery, [actor.name]);
      const actorId = actorResult.length > 0 ? actorResult[0].id : null;

      if (actorId) {
        const movieActorQuery = `INSERT INTO movie_actors (movie_id, actor_id, role) VALUES (?, ?, ?)`;
        await db.promise().query(movieActorQuery, [id, actorId, actor.role]);
      }
    }

    // Insert country
    const countryQuery = `SELECT id FROM countries WHERE country_name = ?`;
    const [countryResult] = await db.promise().query(countryQuery, [country]);
    const countryId = countryResult.length > 0 ? countryResult[0].id : null;

    if (countryId) {
      const movieCountryQuery = `INSERT INTO movie_countries (movie_id, country_id) VALUES (?, ?)`;
      await db.promise().query(movieCountryQuery, [id, countryId]);
    }

    // Insert awards
    for (const award of awards) {
      const awardQuery = `SELECT id FROM awards WHERE awards_name = ?`;
      const [awardResult] = await db.promise().query(awardQuery, [award]);
      const awardId = awardResult.length > 0 ? awardResult[0].id : null;

      if (awardId) {
        const movieAwardQuery = `INSERT INTO movie_awards (movie_id, awards_id) VALUES (?, ?)`;
        await db.promise().query(movieAwardQuery, [id, awardId]);
      }
    }

    res.status(200).json({ message: "Drama updated successfully", movieId: id });
  } catch (err) {
    console.error("Error executing query:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



//SET TRASH
app.put("/movie-delete/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const movieId = req.params.id;

  const query = `UPDATE movies SET status = 0 WHERE id = ?`;

  db.query(query, [movieId], (err, result) => {
    if (err) {
      console.error("Error executing query:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.status(200).json({ message: "Movie moved to trash successfully" });
  });
});

//REJECTED MOVIES
app.put("/movie-rejected/:id", isAuthenticated, hasAdminRole,(req, res) => {
  const movieId = req.params.id;

  const query = `UPDATE movies SET status = 2 WHERE id = ?`;

  db.query(query, [movieId], (err, result) => {
    if (err) {
      console.error("Error executing query:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.status(200).json({ message: "Movie moved to trash successfully" });
  });
});

//PERMANENT DELETE
// Endpoint untuk mengubah status menjadi 3 (permanen delete dari trash)
app.put("/movie-permanent-delete/:id",isAuthenticated, hasAdminRole, (req, res) => {
  const movieId = req.params.id;

  const query = `UPDATE movies SET status = 4 WHERE id = ?`;

  db.query(query, [movieId], (err, result) => {
    if (err) {
      console.error("Error executing query:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.status(200).json({ message: "Movie permanently deleted successfully" });
  });
});

//RESTORE
app.put("/movie-restore/:id", isAuthenticated, hasAdminRole, (req, res) => {
  const movieId = req.params.id;
  const query = `UPDATE movies SET status = 1 WHERE id = ?`;

  db.query(query, [movieId], (err, result) => {
    if (err) {
      console.error("Error executing query:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.status(200).json({ message: "Movie restored successfully" });
  });
});

//LOGIN
app.post("/login", (req, res) => {
  const query = "SELECT * FROM users WHERE Status_Account IN (1, 2) AND email = ?";

  db.query(query, [req.body.email], (err, data) => {
    if (err) {
      return res.json({ Message: "Server Side Error" });
    }

    if (data.length > 0) {
      const user = data[0];

      if (user.Status_Account === 2) {
        return res.json({ Status: "Account Suspended", Message: "Your email has been suspended" });
      }

      if (!user.isEmailConfirmed) {
        return res.json({ Message: "Please confirm your email first." });
      }

      // If a googleId exists but no password, inform the user to log in via Google OAuth
      if (user.googleId && !user.password) {
        return res.json({ Message: "Please log in using Google OAuth." });
      }
      // If no googleId and password exists, proceed with manual login
      if (!user.googleId && user.password) {
        bcrypt.compare(req.body.password, user.password, (err, result) => {
          if (err) {
            return res.json({ Message: "Error comparing password" });
          }

          if (result) {
            const token = jwt.sign(
              {
                username: user.username,
                email: user.email,
                role: user.role,
                user_id: user.id,
              },
              "our-jsonwebtoken-secret-key",
              { expiresIn: "1d" }
            );

            // Send token and user_id in cookies
            res.cookie("token", token, { httpOnly: false, sameSite: "strict", secure: false });
            res.cookie("user_id", user.id, {
              httpOnly: false,
              sameSite: "strict",
              secure: false,
            });
            res.cookie("role", user.role, {
              httpOnly: false,
              sameSite: "strict",
              secure: false,
            }); // Tambahkan role ke cookie

            return res.json({
              Status: "Login Success",
              id: user.id,
              username: user.username,
              email: user.email,
              role: user.role,
              token: token,
            });
          } else {
            return res.json({ Message: "Incorrect Password" });
          }
        });
      } else {
        return res.json({ Message: "User not found or missing credentials." });
      }
    } else {
      return res.json({ Message: "No user found with that email." });
    }
  });
});

//Login with Google

// Google OAuth login route
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

// Google OAuth callback route
app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "http://localhost:3001/login?error=google-auth-failed",
    failureMessage: true,
  }),
  (req, res) => {
    const user = req.user;

    // Check if user suspended or not
    if (user.Status_Account === 2) {
      // Redirect with a custom error message in query params
      return res.redirect(
        `http://localhost:3001/login?error=Account_Suspended`
      );
    }

    // Generate JWT token with user info, including role
    const token = jwt.sign(
      {
        username: user.username,
        email: user.email,
        role: user.role,
        user_id: user.id,
      },
      "our-jsonwebtoken-secret-key",
      { expiresIn: "1d" }
    );

    // Set token, user_id, and role cookies
    res.cookie("token", token, {
      httpOnly: false,
      sameSite: "Strict",
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("user_id", user.id, { httpOnly: false, sameSite: "strict" });
    res.cookie("role", user.role, { httpOnly: false, sameSite: "strict" });

    // Redirect to frontend after successful login
    res.redirect(
      `http://localhost:3001/?username=${user.username}&email=${user.email}&role=${user.role}`
    );
  }
);


app.post("/register", (req, res) => {
  const { username, email, password } = req.body;

  const checkSql = "SELECT * FROM users WHERE username = ? OR email = ?";
  const sql =
    "INSERT INTO users (`username`, `email`, `password`, `isEmailConfirmed`) VALUES (?)";
  const saltRounds = 10;

  // Check if the username or email already exists
  db.query(checkSql, [username, email], (checkErr, checkData) => {
    if (checkErr) {
      console.error("Database check error:", checkErr); // Log the error
      return res.json({ message: "Database error occurred", success: false });
    }
    if (checkData.length > 0) {
      return res.json({
        message: "Username or Email already exists",
        success: false,
      });
    }

    // Proceed with password hashing and user creation if no duplicate found
    bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
      if (err) {
        return res.json({ message: "Error hashing password", success: false });
      }

      const values = [username, email, hashedPassword, false]; // Default isConfirmed as false

      db.query(sql, [values], (insertErr, insertData) => {
        if (insertErr) {
          return res.json({
            message: "Error during registration",
            success: false,
          });
        }

        // Generate Email Confirmation Token (JWT)
        const emailToken = jwt.sign({ email }, "EMAIL_SECRET", {
          expiresIn: "1d",
        });

        // Send confirmation email
        const confirmationUrl = `http://localhost:8001/confirm-email/${emailToken}`;
        const templatePath = path.join(
          __dirname,
          "template",
          "emailTemplate.html"
        );
        fs.readFile(templatePath, "utf8", (err, htmlTemplate) => {
          if (err) {
            console.error("Error reading email template:", err);
            return res.json({
              message: "Error reading email template",
              success: false,
            });
          }

          // Replace placeholders with actual data
          const emailHtml = htmlTemplate
            .replace(/{{username}}/g, username)
            .replace(/{{confirmationUrl}}/g, confirmationUrl);

          // Mail options
          const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: "Please confirm your email",
            html: emailHtml,
          };

          transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
              return res.json({
                message: "Error sending confirmation email",
                success: false,
              });
            }
            res.json({
              message:
                "Registration successful. Please check your email for confirmation.",
              success: true,
            });
            //redirect into login
            res.redirect("http://localhost:3001/login");
          });
        });
      });
    });
  });
});

app.post("/forgot-password", (req, res) => {
  const { email } = req.body;

  // Check if user exists with the given email
  const checkUserSql = "SELECT * FROM users WHERE email = ?";
  db.query(checkUserSql, [email], (err, userData) => {
    if (err || userData.length === 0) {
      return res.status(404).json({
        message: "User with this email doesn't exist",
        success: false,
      });
    }

    //check if account suspended or not
    if (userData[0].Status_Account === 2) {
      return res.json({
        message: "Account Suspended",
        success: false,
      });
    }

    //only account with traditional login can forgot password
    if (userData[0].googleId) {
      return res.json({
        message: "It looks like you signed up with Google. Please log in using your Google account.",
        success: false,
      });
    }

    const user = userData[0];
    const resetToken = jwt.sign(
      {
        id: user.id,
        passwordVersion: user.password,
      },
      "RESET_PASSWORD_SECRET",
      { expiresIn: "5m" } // Token expires in 5 minutes
    );

    // Create reset link
    const resetLink = `http://localhost:3001/reset-password/${resetToken}`;
    const templatePathReset = path.join(
      __dirname,
      "template",
      "forgotPassword.html"
    );

    // Read the email template file
    fs.readFile(templatePathReset, "utf8", (err, htmlTemplate) => {
      if (err) {
        console.error("Error reading email template:", err);
        return res
          .status(500)
          .json({ message: "Error reading email template", success: false });
      }

      // Replace placeholders in the template with actual data
      const emailHtml = htmlTemplate
        .replace(/{{username}}/g, user.username)
        .replace(/{{resetLink}}/g, resetLink);

      // Mail options
      const mailOptions = {
        from: process.env.EMAIL,
        to: email,
        subject: "Password Reset",
        html: emailHtml, // Use the customized HTML content
      };

      // Send email
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          return res
            .status(500)
            .json({ message: "Error sending reset email", success: false });
        }

        res.json({ message: "Password reset email sent", success: true });
      });
    });
  });
});

app.post("/reset-password/:token", (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  // Verify the token
  jwt.verify(token, "RESET_PASSWORD_SECRET", (err, decoded) => {
    if (err) {
      return res
        .status(400)
        .json({ message: "Invalid or expired token", success: false });
    }

    const { id, passwordVersion } = decoded;

    const getUserSql = "SELECT * FROM users WHERE id = ?";
    db.query(getUserSql, [id], (err, rows) => {
      if (err || rows.length === 0) {
        return res
          .status(404)
          .json({ message: "User not found", success: false });
      }

      const user = rows[0];
      const currentPasswordVersion = user.password;

      // Check if the password has changed since the token was issued
      if (passwordVersion !== currentPasswordVersion) {
        return res
          .status(400)
          .json({
            message: "Invalid token due to password change",
            success: false,
          });
      }

      // Proceed with password reset
      const saltRounds = 10;
      bcrypt.hash(newPassword, saltRounds, (hashErr, hashedPassword) => {
        if (hashErr) {
          return res
            .status(500)
            .json({ message: "Error hashing password", success: false });
        }

        // Update password in the database
        const updatePasswordSql = "UPDATE users SET password = ? WHERE id = ?";
        db.query(updatePasswordSql, [hashedPassword, user.id], (updateErr) => {
          if (updateErr) {
            return res
              .status(500)
              .json({ message: "Error updating password", success: false });
          }

          res.json({ message: "Password updated successfully", success: true });
        });
      });
    });
  });
});

//movie check if reviewed or not
app.get("/movies/:movieId/reviewed/:userId", isAuthenticated, (req, res) => {
  const userId = req.params.userId;
  const movieId = req.params.movieId;

  const query = "SELECT * FROM reviews WHERE user_id = ? AND movie_id = ?";

  db.query(query, [userId, movieId], (err, results) => {
    if (err) {
      console.error("Error executing query:", err.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.json({ reviewed: results.length > 0 });
  });
});



//Input Review
app.post("/reviews", isAuthenticated, (req, res) => {
  const { movie_id, user_id, content, rating } = req.body;

  const query = `
    INSERT INTO reviews (movie_id, user_id, content, rating, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, NOW(), NOW())
  `;

  db.query(query, [movie_id, user_id, content, rating], (err, result) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Error inserting review", error: err });
    }
    res.status(201).json({ message: "Review saved successfully!" });
  });
});

// Starting the server
const PORT = 8001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
