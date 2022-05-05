/* eslint-disable */
const AWS = require('aws-sdk');
const DOMPurify = require('DOMPurify');

/** FOR LOCAL TESTING */
if (process.env.NODE_ENV === 'development') {
  console.log('-----> running in developement mode...');

  const YOUR_PROFILE_NAME_AWS_CLI = '' || process.env.AWS_CLI_PROFILE;

  if (!YOUR_PROFILE_NAME_AWS_CLI) {
    console.log('***** DID YOU REMEMBER TO ADD YOUR PROFILE NAME?...****');
    throw Error('no profile name provided');
  }

  const credentials = new AWS.SharedIniFileCredentials({ profile: YOUR_PROFILE_NAME_AWS_CLI });
  AWS.config.credentials = credentials;

  AWS.config.update({ region: 'ap-southeast-2' });
}
/** FOR LOCAL TESTING */

const TABLE_WEBSOCKET = process.env.TABLE_WEBSOCKET;
const INDEX_BOARDID_CONNECTIONS = process.env.INDEX_BOARDID_CONNECTIONS;

// AWS.config.update({ region: 'ap-southeast-2' });
const docClient = new AWS.DynamoDB.DocumentClient();

/**
 * @typedef {AWS.DynamoDB.DocumentClient.QueryInput} QueryParams
 * @type {QueryParams}
 */
const queryParam = (boardId) => {
  return {
    TableName: TABLE_WEBSOCKET,
    IndexName: INDEX_BOARDID_CONNECTIONS,
    KeyConditionExpression: 'BoardId = :boardId',
    ExpressionAttributeValues: {
      ':boardId': boardId,
    },
  };
};

/**
 * @param {QueryParams} params valid aws query input parameters
 * @param {string?} connectionIdFromEvent the attribute name for the connectionIds
 * @returns {string[]} - the connectionIds in the board
 */
async function getConnectionIds(params, connectionIdFromEvent = '') {
  return await docClient
    .query(params)
    .promise()
    .then((res) => {
      /**
       * @typedef {{ConnectionId: string}} Item
       * @type {Item[]}
       */
      const items = res.Items;

      console.log(JSON.stringify(res, null, 2));

      // no connections
      if (items.length === 0) return [];

      const reduceIds = items.reduce(
        (acc, curItem) => {
          if (curItem.ConnectionId !== connectionIdFromEvent) {
            acc.connectionIds.push(curItem.ConnectionId);
          } else if (connectionIdFromEvent === curItem.ConnectionId) {
            acc.foundCaller = true;
          }

          return acc;
        },
        { foundCaller: false, connectionIds: [] }
      );

      // couldn't find the connectionId from the request context in this table, maybe a spoof
      if (reduceIds.foundCaller === false) {
        return [];
      }
      console.log(JSON.stringify(reduceIds, null, 2));
      return reduceIds.connectionIds;
    })
    .catch((err) => {
      console.error(err.message);
      return [];
    });
}

/**
 * @param {AWS.ApiGatewayManagementApi} apiGateway
 */
function broadMessageToConnections(apiGateway) {
  /**
   * @async
   * @param {string[]} connectionIds
   * @param {object} message
   */
  return async function send(connectionIds, message) {
    // santize message
    let santizedMessage = JSON.parse(message);
    const cleanText = DOMPurify.sanitize(santizedMessage.data.text);
    santizedMessage.data.text = cleanText;
    santizedMessage = JSON.stringify(santizedMessage);

    return await Promise.allSettled(
      connectionIds.map(async (connectionId) =>
        apiGateway.postToConnection({ ConnectionId: connectionId, Data: JSON.stringify(santizedMessage) }).promise()
      )
    );
  };
}

/**
 *
 * @param {Event} event
 * @returns
 */
function createNewApiGateway(event) {
  const { domainName, stage } = event.requestContext;
  const endpoint = `${domainName}/${stage}`;
  const apiGateway = new AWS.ApiGatewayManagementApi({ endpoint });
  return apiGateway;
}

/**
 * @typedef {{message: string}} EventBody
 * @typedef {string} Body
 * @typedef {{domainName: string, stage: string, connectionId: string}} RequestContext
 * @typedef {{requestContext: RequestContext, body: Body }} Event
 * @param {Event} event
 */
module.exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));
  /** @type {EventBody} body */
  const { message = '', boardId = '' } = JSON.parse(event.body);
  if (!message || !boardId) {
    return {
      statusCode: 418,
      body: JSON.stringify({ message: 'I am a little tea-pot' }),
    };
  }
  try {
    const connectionIds = await getConnectionIds(queryParam(boardId), event.requestContext.connectionId);

    if (connectionIds.length === 0) {
      return {
        statusCode: 400,
        body: 'Connection Id From Request Context Not In Table',
      };
    }

    const send = broadMessageToConnections(createNewApiGateway(event));

    const res = await send(connectionIds, message);

    console.log(JSON.stringify(res, null, 2));

    return {
      statusCode: 200,
      body: null,
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify(error) };
  }
};

if (process.env.NODE_ENV === 'development' && require.main === module) {
  console.log('this is a test');
  // eslint-disable-next-line global-require
  const event = require('../../events/websockets/defaultevent.json');
  exports
    .handler(event)
    .then((res) => console.log(res))
    .catch((err) => console.error(err));
}
