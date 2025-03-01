const express = require("express");
const app = express();

const orphanRouter = require("./routes/orphanRoutes");

app.use("/orphans", orphanRouter);

app.listen(3000);