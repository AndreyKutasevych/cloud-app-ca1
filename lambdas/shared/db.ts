import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { actorKey, movieKey, type Role, toRole } from './model';
export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);
export const tableName = process.env.TABLE_NAME!;

// Fetches the role an actor plays in a movie (item m#movieID | a#actorID), if any.
export const getRole = async (movieId: number, actorId: number): Promise<Role | undefined> => {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: movieKey(movieId), SK: actorKey(actorId) } }),
  );
  return Item ? toRole(Item) : undefined;
};
export * from './model';
