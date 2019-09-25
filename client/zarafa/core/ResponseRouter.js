Ext.namespace('Zarafa.core');

/**
 * @class Zarafa.core.ResponseRouter
 * @extends Ext.util.Observable
 *
 * The router for Responses to requests made by the {@link Zarafa.core.Request Request} object.
 * Each response is delivered to its destination {@link Ext.data.Store store} through the
 * {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler}.
 * Upon recieving a response, the ResponseRouter will determine if it is a response to
 * a direct request from the {@link Zarafa.core.Request Request Object} or a notification
 * generated by the PHP-side.
 * If the response came from a request from the {@link Zarafa.core.Request Request Object} a
 * {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} will have been registered
 * by the {@link Ext.data.DataProxy Proxy} which made the request. If the
 * {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} is not available the
 * response is considered a Notification, in which case the
 * {@link Zarafa.core.data.NotificationResolver NotificationResolver} is used to generate
 * a special {@link Zarafa.core.data.AbstractNotificationResponseHandler ResponseHandler} which can
 * update the {@link Ext.data.Store stores} which contain the updated {@link Ext.data.Record records}.
 */
Zarafa.core.ResponseRouter = Ext.extend(Ext.util.Observable, {
	/**
	 * The collection of {@link Zarafa.core.data.AbstractResponseHandler ResponseHandlers}
	 * stored by using the moduleid of the outgoing request.
	 * @property
	 * @type Object
	 */
	responseHandlers : undefined,

	/**
	 * @constructor
	 * @param {Object} config Configuration object
	 */
	constructor : function(config)
	{
		config = config || {};

		Ext.applyIf(config, {
			responseHandlers : {}
		});

		this.addEvents(
			/**
			 * @event beforereceive
			 * Main event which is triggered when data has been received from
			 * the PHP server, and is about to be processed by the router.
			 * @param {Object} data The data which was received by the router.
			 */
			'beforereceive',
			/**
			 * @event afterreceive
			 * Main event which is triggered when the data which has been received from
			 * the PHP server has been processed.
			 * @param {Object} data The data which was received by the router.
			 */
			'afterreceive',
			/**
			 * @event receiveexception
			 * Main event which is triggered when a Request has failed, or the response
			 * doesn't contain sufficient data to handle it.
			 * @param {Object} requestdata The request data which was send to the server.
			 * @param {Object} xmlHttpRequest The raw browser response object.
			 */
			'receiveexception',
			/**
			 * @event response
			 * Main event which is triggered when a response has been received
			 * from the PHP server.
			 * @param {String} module The module name for this response
			 * @param {String} id The module id for this reponse
			 * @param {Object} response The response which was received.
			 * @param {Number} timestamp The {@link Date#getTime timestamp} on which the response was received
			 * @return {Boolean} False to cancel the handling of the response by ResponseHandlers
			 */
			'response'
		);

		Ext.apply(this, config);

		Zarafa.core.ResponseRouter.superclass.constructor.call(this, config);
	},

	/**
	 * Register a {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} to the
	 * Response Router. This handler will be used to handle the Response for the request
	 * with the given identifier.
	 * @param {String} id The unique request identifier on which the ResponseHandler
	 * must be registerdd.
	 * @param {Zarafa.core.data.AbstractResponseHandler} handler The ResponseHandler
	 * which must be registered for the given id.
	 */
	addRequestResponseHandler : function(id, handler)
	{
		this.responseHandlers[id] = handler;
	},

	/**
	 * Get a {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} from
	 * the {@link #responseHandlers} which has been registerd for the given module identifier.
	 * This will automatically deregister the handler to prevent it being used twice.
	 * @param {String} id The unique request identifier on which the ResponseHandler
	 * could be registered.
	 * @return {Zarafa.core.data.AbstractResponseHandler} The registered response handler.
	 * @private
	 */
	getRequestResponseHandler : function(id)
	{
		var handler = this.responseHandlers[id];
		this.removeRequestResponseHandler(id);
		return handler;
	},

	/**
	 * Removes a {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} from the
	 * {@link Zarafa.core.ResponsRouter ResponsRouter} to prevent it being called twice.
	 * @param {String} id The unique request identifier of the ResponseHandler which will be
	 * deregistered from {@link Zarafa.core.ResponsRouter ResponsRouter}.
	 */
	removeRequestResponseHandler : function(id)
	{
		delete this.responseHandlers[id];
	},

	/**
	 * Get a {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler} from
	 * the {@link Zarafa.core.data.NotificationResolver NotificationResolver}. This
	 * will construct a special {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler}
	 * which is dedicated to handling this specific notification.
	 * @param {String} module The module from which the notification originated.
	 * @param {Object} data The response data which was send as notification, this is used
	 * to determine which {@link Ext.data.Store stores} are affected by this notification.
	 * @private
	 */
	getNotificationResponseHandler : function(module, data)
	{
		return container.getNotificationResolver().getHandlerForResponse(module, data);
	},

	/**
	 * This will have a Response from the PHP server and will process it
	 * by delivering the Response over the configured route to the destination.
	 *
	 * @param {Object} data The data object which was received and
	 * must be processed.
	 */
	receive : function(data)
	{
		this.fireEvent('beforereceive', data);

		this.processResponse(data);

		this.fireEvent('afterreceive', data);
	},

	/**
	 * This will report a Receive failure which can be triggered when
	 * the request failed with HTTP-error (e.g. 404) or when the response data
	 * was incomplete. This will go through all
	 * {@link Zarafa.core.data.AbstractResponseHandlers ResponseHandlers} which
	 * are affected by this error to report the error using:
	 * {@link Zarafa.core.data.AbstractResponseHandlers#responseFailure responseFailure}.
	 * @param {Object} requestdata The request data which was send to the server.
	 * @param {Object} xmlHttpRequest The raw browser response object.
	 */
	receiveFailure : function(requestData, xmlHttpRequest)
	{
		this.fireEvent('receiveexception', requestData, xmlHttpRequest);

		// Without requestData we cannot report the request failure
		// back to the requestee.
		if (!Ext.isObject(requestData)) {
			return;
		}

		// Find all registered ResponseHandlers which are affected by this
		// failure and propogate the responseFailure to them, 
		Ext.iterate(requestData.zarafa, function(moduleName, modules) {
			Ext.iterate(modules, function(moduleId, moduleData) {
				var handler = this.getRequestResponseHandler(moduleId);
				if (!Ext.isEmpty(handler)) {
					handler.responseFailure(xmlHttpRequest);
				}
			}, this);
		}, this);
	},

	/**
	 * Resolve all response data into a collection of {@link Zarafa.core.data.AbstractResponseHandlers}
	 * which will be in charge of handling all responsed. The responsehandlers will be returned into
	 * an array which is sorted on priority, meaning that the response handlers should be called in
	 * the order in which they are listed in the array.
	 * @param {Object} data The data from the response
	 * @return {Array} Array of objects containing the data
	 * @private
	 */
	resolveResponseHandlers : function(data)
	{
		var responses = [];
		var notifications = [];

		// Iterate over all modules and ids, and obtain the corresponding
		// ResponseHandlers. We separate the RequestResponses from the notifications.
		Ext.iterate(data, function(moduleName, modules) {
			// iterate over module ids
			Ext.iterate(modules, function(moduleId, moduleData) {
				var handler = {
					moduleName : moduleName,
					moduleId : moduleId,
					moduleData : moduleData
				};

				// Check if a RequestResponse Handler is registered for this moduleId
				handler.handler = this.getRequestResponseHandler(moduleId);
				if (!Ext.isEmpty(handler.handler)) {
					responses.push(handler);
					return;
				}

				// No RequestResponse was available, this is a notification
				handler.handler = this.getNotificationResponseHandler(moduleName, moduleData);
				if (!Ext.isEmpty(handler.handler)) {
					notifications.push(handler);
					return;
				}
			}, this);
		}, this);

		// Return the objects as a single array, the RequestResponses have highest priority,
		// followed by the notifications.
		return responses.concat(notifications);
	},

	/**
	 * Perform a transaction through the {@link Zarafa.core.data.AbstractResponseHandler ResponseHandler}.
	 *
	 * @param {Zarafa.core.data.AbstractResponseHandler} handler The handler which should be used
	 * for handling the response.
	 * @param {String} moduleName The name of the module from which the response was received
	 * @param {String} moduleId The unique id which is used to correlate the response to a request
	 * @param {Object} moduleData The data which was provided for the given moduleName/moduleId
	 * @param {Number} timestamp The {@link Date#getTime timestamp} on which the response was received
	 * @private
	 */
	handleResponse : function(handler, moduleName, moduleId, moduleData, timestamp)
	{
		var success = true;

		// Begin the Response transaction. When the transaction cannot
		// be started, we bail out immediately.
		if (handler.start(moduleName, moduleId, moduleData, timestamp) === false) {
			return;
		}

		if (Ext.isObject(moduleData)) {
			// Iterate over each action, and start handling them with
			// the corresponding actionData. If one of the handlers indicate
			// failure, we only change the 'success' status, but continue
			// with the other handlers. The 'success' status itself will
			// be used when the transaction is being completed.
			Ext.iterate(moduleData, function(actionType, actionData) {
				if (handler.handle(actionType, actionData) === false) {
					success = false;
				}
			}, this);
		}

		// Complete the transaction.
		handler.done(success);
	},

	/**
	 * Processes a response from the server. the data is examined for
	 * any error tags and call error listeners.
	 * @param {Object} jsonData A JSON object containing server response.
	 * @private
	 */
	processResponse : function(jsonData)
	{
		// check for errors, these are global errors which can be generated from kopano.php
		// file, module level errors will be handled by module callback functions.
		if (!Ext.isEmpty(jsonData.zarafa.error)) {
			// Fire the exception event on the DataProxy like this, as the response cannot be matched to a specific proxy.
			Ext.data.DataProxy.fireEvent('exception', Ext.data.DataProxy, 'remote', null, null, jsonData.zarafa, null);
			return;
		}

		// Create the timestamp which is used as receive date for the current response
		var timestamp = new Date().getTime();

		// when all's fine, unpack the server response and obtain the responseHandlers
		var handlers = this.resolveResponseHandlers(jsonData.zarafa);

		for (var i = 0, len = handlers.length; i < len; i++) {
			var handler = handlers[i];
			var moduleName = handler.moduleName;
			var moduleId = handler.moduleId;
			var moduleData = handler.moduleData;
			var responseHandler = handler.handler;

			if (this.fireEvent('response', moduleName, moduleId, moduleData, timestamp) !== false) {
				this.handleResponse(responseHandler, moduleName, moduleId, moduleData, timestamp);
			}
		}
	}
});
