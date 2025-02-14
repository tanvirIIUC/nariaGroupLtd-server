const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const app = express();
// 
// middlewares
app.use(cors());
app.use(express.json());

const uri = process.env.ACCESS_DATABASE_URL;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    });
}


async function run() {
    try {   
        const usersCollection = client.db("nariaGroupLtd").collection("users");
        const tasksCollection = client.db("nariaGroupLtd").collection("tasks");


        app.get('/jwt', async (req, res) => {
            const email = req.query.email;

            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '7d' });
            return res.send({ accessToken: token });

        });

        //get  user
        app.get('/users', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await usersCollection.findOne(query);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;

            // Validate required fields (remove strict email checks)
            if (!user.name || !user.email || !user.password) {
                return res.status(400).send({ message: 'Name, email, and password are required' });
            }

            // Check if the email already exists
            const query = { email: user.email };
            const userExists = await usersCollection.findOne(query);
            if (userExists) {
                return res.status(400).send({ message: 'User already exists' });
            }

            // Hash the password
            const hashedPassword = await bcrypt.hash(user.password, 10);

            // Save user to the database
            const newUser = {
                ...user,
                password: hashedPassword,
                created_at: new Date(),
            };

            try {
                const result = await usersCollection.insertOne(newUser);
                res.status(201).send(result);
            } catch (error) {
                console.error('Error saving user:', error);
                res.status(500).send({ message: 'Internal Server Error', error: error.message });
            }
        });
        app.put('/users', async (req, res) => {
            const email = req.query.email; // Get email from query params
            const { name } = req.body; // Extract new name from request body

            if (!email || !name) {
                return res.status(400).json({ message: "Email and name are required." });
            }

            const filter = { email: email };
            const updateDoc = {
                $set: { name: name }
            };

            const result = await usersCollection.updateOne(filter, updateDoc);

            if (result.modifiedCount > 0) {
                res.json({ success: true, message: "Profile updated successfully" });
            } else {
                res.status(400).json({ success: false, message: "No changes made or user not found" });
            }
        });
        app.post('/tasks', async (req, res) => {
            const { userId, title, description, dueDate, status } = req.body;

            if (!userId || !title || !dueDate || !status) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            const newTask = {
                userId,
                title,
                description,
                dueDate,
                status,
            };

            const result = await tasksCollection.insertOne(newTask);
            res.status(201).json({ message: "Task created successfully", taskId: result.insertedId });
        });
        //my tasks
        app.get('/tasks', verifyJWT,async (req, res) => {
            const userId = req.query.userId; // Filter tasks by userId

            if (!userId) {
                return res.status(400).json({ message: "User ID is required" });
            }

            const tasks = await tasksCollection.find({ userId }).toArray();
            res.json(tasks);
        });
        app.put('/tasks/:id', async (req, res) => {
            const { id } = req.params;
            const { title, description, dueDate, status } = req.body;

            // Validate incoming data
            if (!title || !dueDate || !status) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            const updatedTask = { title, description, dueDate, status };

            try {
                const result = await tasksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedTask }
                );
                if (result.modifiedCount === 0) {
                    return res.status(404).json({ message: "Task not found or no change in data" });
                }
                res.status(200).json({ message: "Task updated successfully" });
            } catch (err) {
                res.status(500).json({ message: "Error updating task", error: err.message });
            }
        });
        // DELETE task by ID
        app.delete('/tasks/:id', async (req, res) => {
            const { id } = req.params;
            console.log(id)


            try {
                // Perform the deletion
                const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });

                // If no task was found to delete
                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: "Task not found" });
                }

                // Successful deletion
                res.status(200).json({ message: "Task deleted successfully" });
            } catch (err) {
                // Log the error and return a response
                console.error('Error deleting task:', err.message);
                res.status(500).json({ message: "Error deleting task", error: err.message });
            }
        });
        app.get('/allTasks', async (req, res) => {
            try {
                const tasks = await tasksCollection.aggregate([
                    {
                        $addFields: { userIdObj: { $toObjectId: "$userId" } } // Convert userId string to ObjectId
                    },
                    {
                        $lookup: {
                            from: "users", // The collection name where user details are stored
                            localField: "userIdObj", // Converted ObjectId
                            foreignField: "_id", // The _id field in usersCollection
                            as: "userDetails"
                        }
                    },
                    {
                        $unwind: {
                            path: "$userDetails",
                            preserveNullAndEmptyArrays: true // Keep tasks even if user not found
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            title: 1,
                            description: 1,
                            dueDate: 1,
                            status: 1,
                            CreatorName: "$userDetails.name" // Extract only user name
                        }
                    }
                ]).toArray();
        
                if (!tasks.length) {
                    return res.status(404).json({ message: "No tasks found" });
                }
        
                res.json(tasks);
            } catch (err) {
                console.error("Error fetching tasks:", err.message);
                res.status(500).json({ message: "Error fetching tasks", error: err.message });
            }
        });


    }
    finally {

    }

}

run().catch(err => console.error(err));


app.get('/', async (req, res) => {
    res.send('nariaGroupLtd server is running')
});

app.listen(port, () => {
    console.log(`nariaGroupLtd Server is running on ${[port]}`);
});