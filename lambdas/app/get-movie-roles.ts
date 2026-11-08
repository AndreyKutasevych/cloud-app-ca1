import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  ddb,
  getRole,
  isMovieItem,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response, serverError } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    // ?actor=... : fetch that one role directly.
    if (actorId !== undefined) {
      const role = await getRole(movieId, actorId);
      if (!role) {
        return response(404, {
          message: `No role found for actor ${actorId} in movie ${movieId}`,
        });
      }
      return response(200, { data: role });
    }

        // No filter: the m#movieID partition holds the movie item plus all its roles.
    // A query returns at most 1 MB per call; follow LastEvaluatedKey for the rest.
    const resultItems: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const page = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": movieKey(movieId) },
          ExclusiveStartKey: lastKey,
        })
      );
      resultItems.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    
    if (!resultItems.some(isMovieItem)) {
      return response(404, { message: `Movie ${movieId} not found` });
    }
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    return serverError(err);
  }
};