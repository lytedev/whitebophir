/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

var Tools = {};

Tools.socket = io.connect('', {
	"reconnection delay": 1, //Make the xhr connections as fast as possible
});

Tools.board = document.getElementById("board");
Tools.svg = document.getElementById("canvas");
Tools.curTool = null;

Tools.boardName = (function () {
	var path = window.location.pathname.split("/");
	return path[path.length - 1];
})();

//Get the board as soon as the page is loaded
Tools.socket.emit("getboard", Tools.boardName);

Tools.HTML = {
	template: new Minitpl("#tools > .tool"),
	addTool: function (toolName, toolIcon) {
		var callback = function () {
			Tools.change(toolName);
		};
		return this.template.add(function (elem) {
			elem.addEventListener("click", callback);
			elem.id = "toolID-" + toolName;
			elem.getElementsByClassName("tool-name")[0].textContent = toolName;
			elem.getElementsByClassName("tool-icon")[0].textContent = toolIcon;
			Tools.i18n.translateDOM();
		});
	},
	changeTool: function (oldToolName, newToolName) {
		var oldTool = document.getElementById("toolID-" + oldToolName);
		var newTool = document.getElementById("toolID-" + newToolName);
		if (oldTool) oldTool.classList.remove("curTool");
		if (newTool) newTool.classList.add("curTool");
	},
	addStylesheet: function (href) {
		//Adds a css stylesheet to the html or svg document
		var link = document.createElement("link");
		link.href = href;
		link.rel = "stylesheet";
		link.type = "text/css";
		document.head.appendChild(link);
	}
};

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.add = function (newTool) {
	if (newTool.name in Tools.list) {
		console.log("Tools.add: The tool '" + newTool.name + "' is already" +
			"in the list. Updating it...");
	}

	//Format the new tool correctly
	Tools.applyHooks(Tools.toolHooks, newTool);

	//Add the tool to the list
	Tools.list[newTool.name] = newTool;

	if (newTool.stylesheet) {
		Tools.HTML.addStylesheet(newTool.stylesheet);
	}

	//Add the tool to the GUI
	Tools.HTML.addTool(newTool.name, newTool.icon);

	//There may be pending messages for the tool
	var pending = Tools.pendingMessages[newTool.name];
	if (pending) {
		console.log("Drawing pending messages for '%s'.", newTool.name);
		var msg;
		while (msg = pending.shift()) {
			//Transmit the message to the tool (precising that it comes from the network)
			newTool.draw(msg, false);
		}
	}
};

Tools.change = function (toolName) {
	if (!(toolName in Tools.list)) {
		throw "Trying to select a tool that has never been added!";
	}

	var newtool = Tools.list[toolName];

	//Update the GUI
	var curToolName = (Tools.curTool) ? Tools.curTool.name : "";
	try {
		Tools.HTML.changeTool(curToolName, toolName);
	} catch (e) {
		console.error("Unable to update the GUI with the new tool. " + e);
	}
	Tools.svg.style.cursor = newtool.mouseCursor || "auto";

	//There is not necessarily already a curTool
	if (Tools.curTool !== null) {
		//It's useless to do anything if the new tool is already selected
		if (newtool === Tools.curTool) return;

		//Remove the old event listeners
		for (var event in Tools.curTool.compiledListeners) {
			var listener = Tools.curTool.compiledListeners[event];
			Tools.board.removeEventListener(event, listener);
		}

		//Call the callbacks of the old tool
		Tools.curTool.onquit(newtool);
	}

	//Add the new event listeners
	for (var event in newtool.compiledListeners) {
		var listener = newtool.compiledListeners[event];
		Tools.board.addEventListener(event, listener, { 'passive': false });
	}

	//Call the start callback of the new tool
	newtool.onstart(Tools.curTool);
	Tools.curTool = newtool;
};

Tools.send = function (data, toolName) {
	toolName = toolName || Tools.curTool.name;
	var d = data;
	d.tool = toolName;
	Tools.applyHooks(Tools.messageHooks, d);
	var message = {
		"board": Tools.boardName,
		"data": d
	}
	Tools.socket.emit('broadcast', message);
};

Tools.drawAndSend = function (data) {
	Tools.curTool.draw(data, true);
	Tools.send(data);
};

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = {};

//Receive draw instructions from the server
Tools.socket.on("broadcast", function (message) {
	function messageForTool(message) {
		var name = message.tool,
			tool = Tools.list[name];
		if (tool) {
			Tools.applyHooks(Tools.messageHooks, message);
			tool.draw(message, false);
		} else {
			///We received a message destinated to a tool that we don't have
			//So we add it to the pending messages
			if (!Tools.pendingMessages[name]) Tools.pendingMessages[name] = [message];
			else Tools.pendingMessages[name].push(message);
		}
	}

	//Check if the message is in the expected format
	if (message.tool) {
		messageForTool(message);
	}
	if (message._children) {
		for (var i = 0; i < message._children.length; i++) {
			//Apply hooks on children too
			var msg = message._children[i];
			messageForTool(msg);
		}
	}
	if (!message.tool && !message._children) {
		console.error("Received a badly formatted message (no tool). ", message);
	}
});

Tools.unreadMessagesCount = 0;
Tools.newUnreadMessage = function () {
	document.title = "(" + (++Tools.unreadMessagesCount) + ") SCOW - Simple, Online Collaborative Whiteboard";
};

window.addEventListener("focus", function () {
	Tools.unreadMessagesCount = 0;
	document.title = "SCOW - Simple, Online Collaborative Whiteboard";
});

//List of hook functions that will be applied to messages before sending or drawing them
Tools.messageHooks = [
	function resizeCanvas(m) {
		//Enlarge the canvas is something is drawn near its border
		if (m.x && m.y) {
			var svg = Tools.svg, x = m.x, y = m.y;
			if (x > svg.width.baseVal.value - 1000) {
				svg.width.baseVal.value = x + 2000;
			}
			if (y > svg.height.baseVal.value - 500) {
				svg.height.baseVal.value = y + 2000;
			}
		}
	},
	function updateUnreadCount(m) {
		if (document.hidden && ["child", "update"].indexOf(m.type) === -1) {
			Tools.newUnreadMessage();
		}
	}
];

//List of hook functions that will be applied to tools before adding them
Tools.toolHooks = [
	function checkToolAttributes(tool) {
		if (typeof (tool.name) !== "string") throw "A tool must have a name";
		if (typeof (tool.listeners) !== "object") {
			tool.listeners = {};
		}
		if (typeof (tool.onstart) !== "function") {
			tool.onstart = function () { };
		}
		if (typeof (tool.onquit) !== "function") {
			tool.onquit = function () { };
		}
	},
	function compileListeners(tool) {
		//compile listeners into compiledListeners
		var listeners = tool.listeners;

		//A tool may provide precompiled listeners
		var compiled = tool.compiledListeners || {};
		tool.compiledListeners = compiled;

		function compile(listener) { //closure
			return (function listen(evt) {
				var x = evt.pageX,
					y = evt.pageY;
				return listener(x, y, evt, false);
			});
		}

		function compileTouch(listener) { //closure
			return (function touchListen(evt) {
				//Currently, we don't handle multitouch
				if (evt.changedTouches.length === 1) {
					//evt.preventDefault();
					var touch = evt.changedTouches[0];
					var x = touch.pageX,
						y = touch.pageY;
					return listener(x, y, evt, true);
				}
				return true;
			});
		}

		if (listeners.press) {
			compiled["mousedown"] = compile(listeners.press);
			compiled["touchstart"] = compileTouch(listeners.press);
		}
		if (listeners.move) {
			compiled["mousemove"] = compile(listeners.move);
			compiled["touchmove"] = compileTouch(listeners.move);
		}
		if (listeners.release) {
			var release = compile(listeners.release),
				releaseTouch = compileTouch(listeners.release);
			compiled["mouseup"] = release;
			compiled["mouseleave"] = release;
			compiled["touchleave"] = releaseTouch;
			compiled["touchend"] = releaseTouch;
			compiled["touchcancel"] = releaseTouch;
		}
	}
];

Tools.applyHooks = function (hooks, object) {
	//Apply every hooks on the object
	hooks.forEach(function (hook) {
		hook(object);
	});
};


// Utility functions

Tools.generateUID = function (prefix, suffix) {
	var uid = Date.now().toString(36); //Create the uids in chronological order
	uid += (Math.round(Math.random() * 36)).toString(36); //Add a random character at the end
	if (prefix) uid = prefix + uid;
	if (suffix) uid = uid + suffix;
	return uid;
};

Tools.createSVGElement = function (name) {
	return document.createElementNS(Tools.svg.namespaceURI, name);
};

Tools.positionElement = function (elem, x, y) {
	elem.style.top = y + "px";
	elem.style.left = x + "px";
};

Tools.getColor = (function color() {
	var chooser = document.getElementById("chooseColor");
	return function () { return chooser.value; };
})();

Tools.getSize = (function size() {
	var chooser = document.getElementById("chooseSize");

	function update() {
		if (chooser.value < 1 || chooser.value > 50) {
			chooser.value = 3;
		}
	}
	update();

	chooser.onchange = update;
	return function () { return chooser.value; };
})();

Tools.i18n = (function i18n() {
	var lng = (navigator.language || navigator.browserLanguage).split('-')[0];
	var translations = {};
	var state = "pending";
	var xhr = new XMLHttpRequest;
	xhr.open("GET", "/translations/" + lng + ".json");
	xhr.send(null);
	xhr.onload = function () {
		state = xhr.status === 200 ? "loaded" : "error";
		if (state !== "loaded") return;
		translations = JSON.parse(xhr.responseText);
		Tools.i18n.translateDOM();
	}
	return {
		"t": function translate(s) {
			return translations[s] || s;
		},
		"translateDOM": function translateDOM() {
			if (state !== "loaded") return false;
			var els = document.querySelectorAll("[data-translation=waiting]");
			for (var i = 0; i < els.length; i++) {
				var el = els[i];
				el.setAttribute("data-translation", "done");
				el.innerHTML = Tools.i18n.t(el.innerHTML);
			}
			return true;
		}
	};
})();

//Scale the canvas on load
Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;

(function menu() {
	var menu = document.getElementById("menu");
	var menuText = document.getElementById("menu-toggle-text");
	tog = document.getElementById("toggleMenu");

	tog.onclick = function (e) {
		menu.classList.toggle("closed");

		// this may break the translation system...?
		var isClosed = menu.classList.contains("closed");
		menuText.textContent = isClosed ? "Menu" : "Hide";
	};
})();

/***********  Polyfills  ***********/
if (!window.performance || !window.performance.now) {
	window.performance = {
		"now": Date.now
	}
}
if (!Math.hypot) {
	Math.hypot = function (x, y) {
		//The true Math.hypot accepts any number of parameters
		return Math.sqrt(x * x + y * y);
	}
}

/**
 What does a "tool" object look like?
 newtool = {
	"name" : "SuperTool",
	"listeners" : {
		"press" : function(x,y,evt){...},
		"move" : function(x,y,evt){...},
			"release" : function(x,y,evt){...},
	},
	"draw" : function(data, isLocal){
		//Print the data on Tools.svg
	},
	"onstart" : function(oldTool){...},
	"onquit" : function(newTool){...},
	"stylesheet" : "style.css",
}
*/
