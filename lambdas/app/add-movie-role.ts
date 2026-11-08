import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response, serverError } from "../shared/http";
import { logRequest } from "../shared/request-logger";

// IDs are JSON numbers (not strings) and must be positive integers.
const isPositiveInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isNonEmptyString = (value: unknown): boolean =>
  typeof value === "string" && value.trim() !== "";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  const invalidFields = [
    ["movieId", isPositiveInteger(body.movieId)],
    ["actorId", isPositiveInteger(body.actorId)],
    ["roleName", isNonEmptyString(body.roleName)],
    ["roleDescription", isNonEmptyString(body.roleDescription)],
  ]
    .filter(([, valid]) => !valid)
    .map(([field]) => field);
  if (invalidFields.length) {
    return response(400, {
      message: `Missing or invalid fields: ${invalidFields.join(", ")}`,
    });
  }

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  try {
    // One transaction: the movie and actor must exist, and the role must be new.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { PK: movieKey(role.movieId), SK: actorKey(role.actorId), ...role },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    // CancellationReasons are in TransactItems order: movie, actor, role.
    if (err instanceof TransactionCanceledException) {
      const [movie, actor, existingRole] = (err.CancellationReasons ?? []).map(
        (reason) => reason.Code === "ConditionalCheckFailed"
      );
      if (movie) return response(404, { message: `Movie ${role.movieId} not found` });
      if (actor) return response(404, { message: `Actor ${role.actorId} not found` });
      if (existingRole) {
        return response(409, {
          message: `Actor ${role.actorId} already has a role in movie ${role.movieId}`,
        });
      }
    }
    return serverError(err);
  }
};