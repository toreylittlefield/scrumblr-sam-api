/* eslint-disable */
const AWS = require('aws-sdk');
const TABLE_WEBSOCKET = process.env.TABLE_WEBSOCKET;

// AWS.config.update({ region: 'ap-southeast-2' });
const docClient = new AWS.DynamoDB.DocumentClient();

/**
 * @typedef {AWS.DynamoDB.DocumentClient.ScanInput} ScanInput
 * @type {ScanInput}
 */
const params = {
  TableName: TABLE_WEBSOCKET,
};

/**
 * @param {ScanInput} params valid aws query input parameters
 * @param {string?} attrName the attribute name for the connectionIds
 * @returns {string[]} - the connectionIds in the board
 */
async function getConnectionIds(params, attrName = '') {
  return await docClient
    .scan(params)
    .promise()
    .then((res) => {
      /**
       * @typedef {{ConnectionId: string}} Item
       * @type {Item[]}
       */
      const items = res.Items;
      const connectionIds = items.map((item) => item.ConnectionId);
      console.log(JSON.stringify(connectionIds, null, 2));
      return connectionIds;
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
    return await Promise.allSettled(
      connectionIds.map(async (connectionId) =>
        apiGateway.postToConnection({ ConnectionId: connectionId, Data: JSON.stringify(message) }).promise()
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
  const { message = 'custom message goes here: remove me later' } = JSON.parse(event.body);
  if (!message) {
    return {
      statusCode: 418,
      body: JSON.stringify({ message: 'I am a little tea-pot' }),
    };
  }
  const connectionIds = await getConnectionIds(params);
  const filteredIds = connectionIds.filter((id) => id !== event.requestContext.connectionId);
  const send = broadMessageToConnections(createNewApiGateway(event));
  const res = await send(filteredIds, message);
  console.log(JSON.stringify(res, null, 2));
  return {
    statusCode: 200,
    body: null,
  };
};
