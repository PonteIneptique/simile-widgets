/*======================================================================
 *  Exhibit
 *  http://simile.mit.edu/wiki/Exhibit/API/Exhibit
 *======================================================================
 */
Exhibit.create = function(controlDiv, browseDiv, viewDiv, configuration) {
    return new Exhibit._Impl(controlDiv, browseDiv, viewDiv, configuration);
};

Exhibit.protectUI = function(elmt) {
    SimileAjax.DOM.appendClassName(elmt, "exhibit-ui-protection");
};

/*==================================================
 *  Exhibit._Impl
 *==================================================
 */
Exhibit._Impl = function(controlDiv, browseDiv, viewDiv, configuration) {
    if (configuration == null) {
        configuration = {};
    }
    this._configuration = configuration;
    
    this._database = new Exhibit.Database();
    this._engine = new Exhibit.BrowseEngine(this._database, configuration);
    this._browsePanel = new Exhibit.BrowsePanel(this, browseDiv, configuration);
    this._viewPanel = new Exhibit.ViewPanel(this, viewDiv, configuration);
    this._busyIndicator = Exhibit.Theme.createBusyIndicator();
    
    this._exporters = "exporters" in configuration ? configuration.exporters : {};
    this._exporters["rdf/xml"] = {
        exporter:   Exhibit.RdfXmlExporter
    };
    this._exporters["smw"] = {
        exporter:   Exhibit.SemanticWikitextExporter
    };
    
    var self = this;
    this._focusID = null;
    this._databaseListener = {
        onAfterLoadingItems: function() {
            self._tryToFocusOnItem();
        }
    };
    this._database.addListener(this._databaseListener);
    
    this._historyListener = {
        onBeforePerform: function(action) {
            if (action.lengthy) {
                self._showBusyIndicator();
            }
        },
        onAfterPerform: function(action) {
            if (action.lengthy) {
                self._hideBusyIndicator();
            }
        },
        onBeforeUndoSeveral: function() {
            self._showBusyIndicator();
        },
        onAfterUndoSeveral: function() {
            self._hideBusyIndicator();
        },
        onBeforeRedoSeveral: function() {
            self._showBusyIndicator();
        },
        onAfterRedoSeveral: function() {
            self._hideBusyIndicator();
        }
    };
    SimileAjax.History.addListener(this._historyListener);
    
    this._parseURL();
};

Exhibit._Impl.prototype.getDatabase = function() { return this._database; };
Exhibit._Impl.prototype.getBrowseEngine = function() { return this._engine; };
Exhibit._Impl.prototype.getBrowsePanel = function() { return this._browsePanel; };
Exhibit._Impl.prototype.getViewPanel = function() { return this._viewPanel; };

Exhibit._Impl.prototype.dispose = function() {
    SimileAjax.History.removeListener(this._historyListener);
    this._database.removeListener(this._databaseListener);
};

Exhibit._Impl.prototype.getPermanentLink = function() {
    var state = {};
    
    var engineState = this._engine.getState();
    if (engineState != null) {
        state["browseEngine"] = engineState;
    }
    var browsePanelState = this._browsePanel.getState();
    if (browsePanelState != null) {
        state["browsePanel"] = browsePanelState;
    }
    var viewPanelState = this._viewPanel.getState();
    if (viewPanelState != null) {
        state["viewPanel"] = viewPanelState;
    }
    
    var stateString = this._serializeState(state);
    
    return Exhibit._getURLWithoutQuery() + "?exhibit-state=" + encodeURIComponent(stateString);
};

Exhibit._Impl.prototype.getItemLink = function(itemID) {
    return Exhibit._getURLWithoutQueryAndHash() + "#" + encodeURIComponent(itemID);
};

Exhibit._Impl.prototype.loadJSON = function(urls, fDone) {
    var exhibit = this;
    if (urls instanceof Array) {
        urls = [].concat(urls);
    } else {
        urls = [ urls ];
    }
    
    var fError = function(statusText, status, xmlhttp) {
        SimileAjax.Debug.log("Failed to load data xml from " + urls[0] + "\n" + statusText);
        urls.shift();
        fNext();
    };
    
    var fDone2 = function(xmlhttp) {
        try {
            var o = null;
            try {
                o = eval("(" + xmlhttp.responseText + ")");
            } catch (e) {
                SimileAjax.Debug.exception("Exhibit: Error evaluating JSON results from " + urls[0], e);
            }
            
            if (o != null) {
                exhibit._loadJSON(o, exhibit.getBaseURL(urls[0]));
            }
        } catch (e) {
            SimileAjax.Debug.exception("Exhibit: Error loading next JSON URL", e);
        }
        
        urls.shift();
        fNext();
    };
    
    var fNext = function() {
        if (urls.length > 0) {
            SimileAjax.XmlHttp.get(urls[0], fError, fDone2);
        } else {
            try {
                if (fDone != null) {
                    fDone();
                } else {
                    var browseEngine = exhibit.getBrowseEngine();
                    var database = exhibit.getDatabase();
                    if (browseEngine.getCollectionCount() == 0 &&
                        database.getAllItemsCount() > 0) {
                        browseEngine.setRootCollection(database.getAllItems());
                    }
                }
            } catch (e) {
                SimileAjax.Debug.exception("Exhibit: Error loading next JSON URL", e);
            } finally {
                exhibit._hideBusyIndicator();
            }
        }
    };
    
    exhibit._showBusyIndicator();
    setTimeout(fNext, 0);
};

Exhibit._Impl.prototype.getBaseURL = function(url) {
    if (url.indexOf("://") < 0) {
        var url2 = this.getBaseURL(document.location.href);
        if (url.substr(0,1) == "/") {
            url = url2.substr(0, url2.indexOf("/", url2.indexOf("://") + 3)) + url;
        } else {
            url = url2 + url;
        }
    }
    
    var i = url.lastIndexOf("/");
    if (i < 0) {
        return "";
    } else {
        return url.substr(0, i+1);
    }
};

Exhibit._Impl.prototype.makeActionLink = function(text, handler, layer) {
    var a = document.createElement("a");
    a.href = "javascript:";
    a.className = "exhibit-action";
    a.innerHTML = text;
    
    var handler2 = function(elmt, evt, target) {
        if ("true" == elmt.getAttribute("disabled")) {
            SimileAjax.DOM.cancelEvent(evt);
            return false;
        } else {
            return handler(elmt, evt, target);
        }
    }
    SimileAjax.WindowManager.registerEvent(a, "click", handler2, layer);
    
    return a;
};

Exhibit._Impl.prototype.makeActionLinkWithObject = function(text, obj, handlerName, layer) {
    var a = document.createElement("a");
    a.href = "javascript:";
    a.className = "exhibit-action";
    a.innerHTML = text;
    
    var handler2 = function(elmt, evt, target) {
        if ("true" == elmt.getAttribute("disabled")) {
            SimileAjax.DOM.cancelEvent(evt);
            return false;
        } else {
            return obj[handlerName].call(obj, elmt, evt, target);
        }
    }
    SimileAjax.WindowManager.registerEvent(a, "click", handler2, layer);
    
    return a;
};

Exhibit._Impl.prototype.enableActionLink = function(a, enabled) {
    a.setAttribute("disabled", enabled ? "false" : "true");
    a.className = enabled ? "exhibit-action" : "exhibit-action-disabled";
};

Exhibit._Impl.prototype.makeItemSpan = function(itemID, label, layer) {
    if (label == null) {
        label = this._database.getObject(itemID, "label");
    }
    if (label == null) {
        label = itemID;
    }
    
    var a = document.createElement("a");
    a.href = this.getItemLink(itemID);
    a.className = "exhibit-item";
    a.innerHTML = label;
    
    var exhibit = this;
    var handler = function(elmt, evt, target) {
        exhibit.showItemView(itemID, elmt);
        SimileAjax.DOM.cancelEvent(evt);
        return false;
    }
    SimileAjax.WindowManager.registerEvent(a, "click", handler, layer);
    
    return a;
};

Exhibit._Impl.prototype.makeValueSpan = function(label, valueType, layer) {
    var span = document.createElement("span");
    span.className = "exhibit-value";
    if (valueType == "url") {
        var a = document.createElement("a");
        a.target = "_blank";
        a.href = label;
        if (label.length > 50) {
            a.innerHTML = label.substr(0, 20) + " ... " + label.substr(label.length - 20);
        } else {
            a.innerHTML = label;
        }
        span.appendChild(a);
    } else {
        span.innerHTML = label;
    }
    return span;
};

Exhibit._Impl.prototype.showItemView = function(itemID, elmt) {
    var coords = SimileAjax.DOM.getPageCoordinates(elmt);
    var bubble = SimileAjax.Graphics.createBubbleForPoint(
        document, 
        coords.left + Math.round(elmt.offsetWidth / 2), 
        coords.top + Math.round(elmt.offsetHeight / 2), 
        400, // px
        300  // px
    );
    
    var itemViewDiv = document.createElement("div");
    var itemView = new Exhibit.ItemView(itemID, itemViewDiv, this, this._configuration);
    bubble.content.appendChild(itemViewDiv);
};

Exhibit._Impl.prototype.makeCopyButton = function(itemID, layer) {
    var self = this;
    var button = Exhibit.Theme.createCopyButton(itemID == null);
    var handler = function(elmt, evt, target) {
        self._showCopyMenu(elmt, itemID);
        SimileAjax.DOM.cancelEvent(evt);
        return false;
    }
    SimileAjax.WindowManager.registerEvent(
        button, "click", handler, layer != null ? layer : SimileAjax.WindowManager.getHighestLayer());
        
    return button;
};

Exhibit._Impl.prototype.getExporters = function() {
    return this._exporters;
};

Exhibit._Impl.prototype._loadJSON = function(o, url) {
    if ("types" in o) {
        this._database.loadTypes(o.types, url);
    }
    if ("properties" in o) {
        this._database.loadProperties(o.properties, url);
    }
    if ("items" in o) {
        this._database.loadItems(o.items, url);
    }
};

Exhibit._Impl.prototype._parseURL = function() {
    var params = SimileAjax.parseURLParameters(document.location.href);
    for (var i = 0; i < params.length; i++) {
        var p = params[i];
        if (p.name == "exhibit-state") {
            var state = this._deserializeState(p.value);
            if ("browseEngine" in state) {
                this._engine.setState(state["browseEngine"]);
            }
            if ("browsePanel" in state) {
                this._browsePanel.setState(state["browsePanel"]);
            }
            if ("viewPanel" in state) {
                this._viewPanel.setState(state["viewPanel"]);
            }
        }
    }
    
    var hash = document.location.hash;
    if (hash.length > 1) {
        this._focusID = decodeURIComponent(hash.substr(1));
    }
};

Exhibit._Impl.prototype._tryToFocusOnItem = function() {
    if (this._focusID != null && this._database.containsItem(this._focusID)) {
        var dom = Exhibit.Theme.createFocusDialogBox(this._focusID, this, this._configuration);
        dom.open();
        
        this._focusID = null;
    }
};

Exhibit._Impl.prototype._deserializeState = function(s) {
    return eval(s);
};

Exhibit._Impl.prototype._serializeState = function(state) {
    return Exhibit._anythingToJSON(state);
};

Exhibit._Impl.prototype._showCopyMenu = function(elmt, itemID) {
    var exhibit = this;
    var popupDom = Exhibit.Theme.createPopupMenuDom(elmt);
    
    var makeMenuItem = function(exporter) {
        popupDom.appendMenuItem(
            exporter.getLabel(),
            null,
            function() {
                var text = (itemID) ?
                    exporter.exportOne(itemID, exhibit) :
                    exporter.exportMany(
                        exhibit.getBrowseEngine().getCurrentCollection().getCurrentSet(), exhibit);
                        
                Exhibit.Theme.createCopyDialogBox(text).open();
            }
        );
    }
    
    var exporters = exhibit.getExporters();
    for (format in exporters) {
        makeMenuItem(exporters[format].exporter);
    }
    popupDom.open();
};

Exhibit._Impl.prototype._showBusyIndicator = function() {
    var scrollTop = ("scrollTop" in document.body) ?
        document.body.scrollTop :
        document.body.parentNode.scrollTop;
    var height = ("innerHeight" in window) ?
        window.innerHeight :
        ("clientHeight" in document.body ?
            document.body.clientHeight :
            document.body.parentNode.clientHeight);
        
    var top = Math.floor(scrollTop + height / 3);
    
    this._busyIndicator.style.top = top + "px";
    document.body.appendChild(this._busyIndicator);
};

Exhibit._Impl.prototype._hideBusyIndicator = function() {
    document.body.removeChild(this._busyIndicator);
};

Exhibit._getURLWithoutQueryAndHash = function() {
    var url;
    if ("_urlWithoutQueryAndHash" in Exhibit) {
        url = Exhibit._urlWithoutQueryAndHash;
    } else {
        url = document.location.href;
        
        var hash = url.indexOf("#");
        var question = url.indexOf("?");
        if (hash >= 0) {
            url = url.substr(0, hash);
        } else if (question >= 0) {
            url = url.substr(0, question);
        }
        
        Exhibit._urlWithoutQueryAndHash = url;
    }
    return url;
};

Exhibit._getURLWithoutQuery = function() {
    var url;
    if ("_urlWithoutQuery" in Exhibit) {
        url = Exhibit._urlWithoutQuery;
    } else {
        url = document.location.href;
        
        var question = url.indexOf("?");
        if (question >= 0) {
            url = url.substr(0, question);
        }
        
        Exhibit._urlWithoutQuery = url;
    }
    return url;
};

Exhibit._anythingToJSON = function(x) {
    if (typeof x == "string") {
        return '"' + x + '"';
    } else if (typeof x == "boolean") {
        return x ? "true" : "false";
    } else if (typeof x == "number") {
        return x.toString();
    } else if (typeof x == "object") {
        if (x instanceof Array) {
            var s = "[";
            for (var i = 0; i < x.length; i++) {
                if (i > 0) s += ",";
                s += Exhibit._anythingToJSON(x[i]);
            }
            s += "]";
            return s;
        } else {
            var s = "{";
            var first = true;
            for (m in x) {
                if (first) {
                    first = false;
                } else {
                    s += ",";
                }
                
                s += m + ":" + Exhibit._anythingToJSON(x[m]);
            }
            s += "}";
            return s;
        }
    } else if (x == null) {
        return "null";
    } else {
        return "undefined";
    }
};

