import AWS, { CognitoIdentity, CognitoIdentityServiceProvider } from 'aws-sdk';
import express from 'express';
import winston from 'winston';
import { DynamodbHelper } from 'dynamodb-helper';
import { Environments } from './consts';
import {
  createNewUser,
  deleteRole,
  getCredentialsFromToken,
  lookupUserPoolData,
  provisionAdminUserWithRoles,
} from './utils';
import { User } from 'typings';

// Init the winston log level
winston.add(new winston.transports.Console({ level: 'debug' }));

// update aws config
AWS.config.update({
  region: Environments.AWS_DEFAULT_REGION,
  dynamodb: { endpoint: Environments.AWS_ENDPOINT_URL },
});

/** catch undefined errors */
export const common = async (req: express.Request, res: express.Response, app: any) => {
  winston.info(`request: ${JSON.stringify(req.body)}`);

  try {
    const results = await app(req, res);

    res.status(200).send(results);
  } catch (err) {
    winston.error(err);

    res.status(400).send(err);
  }
};

/**
 * lookup user
 *
 * @param req request
 */
export const lookupUser = async (req: express.Request): Promise<User.LookupUserResponse> => {
  winston.debug('Looking up user pool data for: ' + req.params.id);

  // find user in user pool
  const user = await lookupUserPoolData(req.params.id, true);

  return {
    isExist: user !== undefined,
  };
};

/**
 * Get user details
 *
 * @param req request
 * @returns
 */
export const getUser = async (req: express.Request): Promise<User.GetUserResponse> => {
  winston.debug('Getting user id: ' + req.params.id);

  // tokenManager.getCredentialsFromToken(req, function (credentials) {
  //   // get the tenant id from the request
  //   var tenantId = tokenManager.getTenantId(req);

  //   lookupUserPoolData(credentials, req.params.id, tenantId, false, function (err, user) {
  //     if (err) res.status(400).send('{"Error" : "Error getting user"}');
  //     else {
  //       cognitoUsers.getCognitoUser(credentials, user, function (err, user) {
  //         if (err) {
  //           res.status(400);
  //           res.json('Error lookup user user: ' + req.params.id);
  //         } else {
  //           res.json(user);
  //         }
  //       });
  //     }
  //   });
  // });
  return {};
};

/**
 * Regist tenant admin user
 *
 * @param req request
 * @returns
 */
export const registTenantAdmin = async (
  req: express.Request<any, any, User.TenantAdminRegistRequest>
): Promise<User.TenantAdminRegistResponse> => {
  const request = req.body;

  // create cognito user pool and identity pool
  const cognito = await provisionAdminUserWithRoles(request);

  // create admin user
  const userItem = await createNewUser(request, cognito, 'TENANT_ADMIN');

  return userItem as User.TenantAdminRegistResponse;
};

/**
 * remove all dynamodb tables
 *
 * @param req request
 * @param res response
 */
export const deleteTables = async (req: express.Request, res: express.Response) => {
  const helper = new DynamodbHelper();

  try {
    // user table
    await helper.getClient().deleteTable({ TableName: Environments.TABLE_NAME_USER }).promise();

    // product table
    await helper.getClient().deleteTable({ TableName: Environments.TABLE_NAME_PRODUCT }).promise();

    // order table
    await helper.getClient().deleteTable({ TableName: Environments.TABLE_NAME_ORDER }).promise();

    // tenant table
    await helper.getClient().deleteTable({ TableName: Environments.TABLE_NAME_TENANT }).promise();

    res.status(200).send('Initiated removal of DynamoDB Tables');
  } catch (err) {
    winston.debug(err);
    res.status(400).send(err);
  }
};

/**
 * Delete cognito user pool, identity pool and IAM roles
 *
 * @param req request
 */
export const deleteTenant = async (req: express.Request<any, any, User.DeleteTenantRequest>) => {
  winston.debug('Cleaning up Identity Reference Architecture');

  const { tenantId, userPoolId, identityPoolId } = req.body;

  // delete user pool
  const provider = new CognitoIdentityServiceProvider();
  await provider.deleteUserPool({ UserPoolId: userPoolId }).promise();

  // delete identity pool
  const identity = new CognitoIdentity();
  await identity.deleteIdentityPool({ IdentityPoolId: identityPoolId }).promise();

  // delete iam roles
  await deleteRole(`SaaS_${tenantId}_AdminRole`, 'AdminPolicy');
  await deleteRole(`SaaS_${tenantId}_UserRole`, 'UserPolicy');
  await deleteRole(`SaaS_${tenantId}_AuthRole`);

  const helper = new DynamodbHelper();

  // get all users
  const results = await helper.query({
    TableName: Environments.TABLE_NAME_USER,
    ProjectionExpression: 'tenantId, id',
    KeyConditionExpression: '#tenantId = :tenantId',
    ExpressionAttributeNames: {
      '#tenantId': 'tenantId',
    },
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
    },
  });

  if (results.Items) {
    // remove user rows
    await helper.truncate(Environments.TABLE_NAME_USER, results.Items);
  }
};

export const getUsers = async (req: express.Request) => {
  // get credentials
  const credentials = await getCredentialsFromToken(req);

  // function (req, res) {
  //   tokenManager.getCredentialsFromToken(req, function (credentials) {
  //     var userPoolId = getUserPoolIdFromRequest(req);
  //     cognitoUsers
  //       .getUsersFromPool(credentials, userPoolId, configuration.aws_region)
  //       .then(function (userList) {
  //         res.status(200).send(userList);
  //       })
  //       .catch(function (error) {
  //         res.status(400).send('Error retrieving user list: ' + error.message);
  //       });
  //   });
  // }
};

// health check
export const healthCheck = async (): Promise<User.HealthCheck> => ({ service: 'User Manager', isAlive: true });
