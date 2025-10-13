/*
Script to generate RSA key pair and store in MongoDB.
*/

const { generateKeyPairSync } = require('crypto');

const uri = process.env.AKTO_MONGO_CONN || "mongodb://localhost:27017";
const dbName = "common";

// Connect to MongoDB
const conn = new Mongo(uri);
const db = conn.getDB(dbName);

// Delete existing RSA key pair if it exists
const existingKeys = db.configs.findOne({ _id: "RSA_KP" });
if (existingKeys) {
    print("Existing RSA Key Pair found:");
    print("Public Key:\n", existingKeys.publicKey);
    print("Private Key:\n", existingKeys.privateKey);

    print("Deleting existing RSA key pair...");
    db.configs.deleteOne({ _id: "RSA_KP" });
    print("Existing RSA key pair deleted.");
} else {
    print("No existing RSA Key Pair found. Generating new one...");
}

// Generate RSA key pair
function generateRSAKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
  });
  return { publicKey, privateKey };
}

try {
    print("Generating new RSA key pair...");

    const { publicKey, privateKey } = generateRSAKeyPair();

    print("Public Key:\n", publicKey);
    print("Private Key:\n", privateKey);

    // Store keys in MongoDB
    const result = db.configs.insertOne({
        "_id": "RSA_KP",
        "configType": "RSA_KP",
        "publicKey": publicKey,
        "privateKey": privateKey,
        "_t": "com.akto.dto.Config$RSAKeyPairConfig"
    });

    print("Inserted document with _id:", result.insertedId);
} catch (error) {
    print("Error generating RSA key pair:", error);
    throw error;
}

