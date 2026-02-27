import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI!
let client: MongoClient
let clientPromise: Promise<MongoClient>

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

const options = {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
}

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options)
    global._mongoClientPromise = client.connect()
  }
  clientPromise = global._mongoClientPromise
} else {
  client = new MongoClient(uri, options)
  clientPromise = client.connect()
}

export default clientPromise

export async function getDigestsCollection() {
  const client = await clientPromise
  return client.db('ai-digest').collection('digests')
}
