// extension.js
// vi: et sw=2
//
// Advanced Volume Mixer
// Control programs' volume from gnome volume mixer applet.
//
// Author: Harry Karvonen <harry.karvonen@gmail.com>
//

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Gvc = imports.gi.Gvc;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

const STREAM_DESCRIPTION_MAXLEN = 40;
/* 'Logitech Wireless Heatset Analog Stereo'.length == 39
 * There're USB wireless headsets with even longer descriptions.
 */

// USE_OUTPUT_SUBMENU: place audio output choices in a submenu instead of at the top level.
// Costs one more click per output switch.
const USE_OUTPUT_SUBMENU = false;
const DEBUG = false;

let panelVolumeMixerHasTitle = true;
let actorsHaveUnderscoreMethodNames = false;

let advMixer;


const _MyPopupSliderMenuItem = new Lang.Class({
    Name: 'PopupSliderMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

  _init: function(value) {
    //PopupMenu.PopupBaseMenuItem.prototype._init.call(this,{ activate: false });
    this.parent({ activate: false });
    this._slider = new Slider.Slider(value);
    this._slider.connect('value-changed', Lang.bind(this, function(actor, value) {
        this.emit('value-changed', value);
    }));
    this.actor.add(this._slider.actor, { expand: true });
  },

  setValue: function(value) {
    this._slider.setValue(value);
  },

  get value() {
    return this._slider.value;
  },

  scroll: function (event) {
    this._slider.scroll(event);
  }
});


function AdvPopupSwitchMenuItem() {
  this._init.apply(this, arguments);
}


AdvPopupSwitchMenuItem.prototype = {
  __proto__: PopupMenu.PopupSwitchMenuItem.prototype,

  _init: function(text, active, gicon, params) {
    PopupMenu.PopupSwitchMenuItem.prototype._init.call(
      this,
      " " + text + "  ",
      active,
      params
    );

    this._icon = new St.Icon({
      gicon:        gicon,
      style_class: "adv-volume-icon"
    });

    // Rebuild switch
    if (actorsHaveUnderscoreMethodNames) {      
      this.actor.remove_actor(this._statusBin);
      this.actor.remove_actor(this.label);
    } else {
      this.removeActor(this._statusBin);
      this.removeActor(this.label);
    }

    // Horizontal box
    let labelBox = new St.BoxLayout({vertical: false});

    labelBox.add(this._icon,
                {expand: false, x_fill: false, x_align: St.Align.START});
    labelBox.add(this.label,
                 {expand: false, x_fill: false, x_align: St.Align.START});
    labelBox.add(this._statusBin,
                 {expand: true, x_fill: true, x_align: St.Align.END});
            
    if (actorsHaveUnderscoreMethodNames) {
      this.actor.add_actor(labelBox, {span: -1, expand: true });
    } else {
      this.addActor(labelBox, {span: -1, expand: true });
    }
  }
}


function AdvMixer(mixer) {
  this._init(mixer);
}


AdvMixer.prototype = {
  _init: function(mixer) {
    this._mixer = mixer;
    this._control = mixer._control;
    this._separator = new PopupMenu.PopupSeparatorMenuItem();
    this._items = {};
    this._outputs = {};
    this._outputMenuItemDest = null;

    if (USE_OUTPUT_SUBMENU) {
      this._outputMenu = new PopupMenu.PopupSubMenuMenuItem(_("Volume"));
    }

    this._mixer.menu.addMenuItem(this._separator);

    this._streamAddedId = this._control.connect(
      "stream-added",
      Lang.bind(this, this._streamAdded)
    );
    this._streamRemovedId = this._control.connect(
      "stream-removed",
      Lang.bind(this, this._streamRemoved)
    );
    this._defaultSinkChangedId = this._control.connect(
      "default-sink-changed",
      Lang.bind(this, this._defaultSinkChanged)
    );

    if (panelVolumeMixerHasTitle) {
      // Change Volume title
      let title;
      if (this._mixer._volumeMenu.firstMenuItem['addMenuItem']) {
        title = this._mixer._volumeMenu.firstMenuItem.firstMenuItem;
      } else {
        title = this._mixer._volumeMenu.firstMenuItem;
      }
      title.destroy();
    }

    if (USE_OUTPUT_SUBMENU) {
      if (this._mixer._volumeMenu.firstMenuItem['addMenuItem']) {
        this._mixer._volumeMenu.firstMenuItem.addMenuItem(this._outputMenu, 0);
      } else {
        this._mixer._volumeMenu.addMenuItem(this._outputMenu, 0);
      }
      this._outputMenuItemDest = this._outputMenu;
    } else {
      if (this._mixer._volumeMenu.firstMenuItem['addMenuItem']) {
        this._outputMenuItemDest = this._mixer._volumeMenu.firstMenuItem;
      } else {
        this._outputMenuItemDest = this._mixer._volumeMenu;
      }
    }

    // Add streams
    let streams = this._control.get_streams();
    for (let i = 0; i < streams.length; i++) {
      this._streamAdded(this._control, streams[i].id);
    }

    if (this._control.get_default_sink() != null) {
      this._defaultSinkChanged(
        this._control,
        this._control.get_default_sink().id
      );
    }
  },


  _streamAdded: function(control, id) {
    if (id in this._items) {
      return;
    }

    if (id in this._outputs) {
      return;
    }

    let stream = control.lookup_stream_id(id);
    if (DEBUG) {
      log('streamAdded: id: ' + id + ' ' + stream);
    }

    if (stream["is-event-stream"]) {
      if (DEBUG) {
        log('streamAdded: is-event-stream');
      }
      // Do nothing
    } else if (stream instanceof Gvc.MixerSinkInput) {
      if (DEBUG) {
        log('streamAdded: MixerSinkInput');
      }
      let slider = new _MyPopupSliderMenuItem(
        stream.volume / this._control.get_vol_max_norm()
      );
      let t = stream.description || stream.name;
      if (t.length > STREAM_DESCRIPTION_MAXLEN) {
        t = t.slice(0, STREAM_DESCRIPTION_MAXLEN);
      }
      let title = new AdvPopupSwitchMenuItem(
        t,
        !stream.is_muted,
        stream.get_gicon(),
        {activate: false}
      );

      this._items[id] = {
        slider: slider,
        title: title
      };

      slider.connect(
        "value-changed",
        Lang.bind(this, this._sliderValueChanged, stream.id)
      );

      title.actor.connect(
        "button-release-event",
        Lang.bind(this, this._titleToggleState, stream.id)
      );

      title.actor.connect(
        "key-press-event",
        Lang.bind(this, this._titleToggleState, stream.id)
      );

      stream.connect(
        "notify::volume",
        Lang.bind(this, this._notifyVolume, stream.id)
      );

      stream.connect(
        "notify::is-muted",
        Lang.bind(this, this._notifyIsMuted, stream.id)
      );

      this._mixer.menu.addMenuItem(this._items[id]["slider"], 2);
      this._mixer.menu.addMenuItem(this._items[id]["title"], 2);
    } else if (stream instanceof Gvc.MixerSink) {
      if (DEBUG) {
        log('streamAdded: MixerSink');
      }
      let t = stream.description || stream.name;
      if (t.length > STREAM_DESCRIPTION_MAXLEN) {
        t = t.slice(0, STREAM_DESCRIPTION_MAXLEN);
      }
      let output = new PopupMenu.PopupMenuItem(t);

      output.connect(
        "activate",
        function (item, event) { control.set_default_sink(stream); }
      );

      this._outputMenuItemDest.addMenuItem(output, 0);
      this._outputs[id] = output;
    }
  },

  _streamRemoved: function(control, id) {
    if (DEBUG) {
      log('streamRemoved: id: ' + id);
    }
    if (id in this._items) {
      this._items[id]["slider"].destroy();
      this._items[id]["title"].destroy();
      delete this._items[id];
    }

    if (id in this._outputs) {
      this._outputs[id].destroy();
      delete this._outputs[id];
    }
  },

  _defaultSinkChanged: function(control, id) {
    for (let output in this._outputs) {
      let check = (output == id) ? 2 : 0;
      this._outputs[output].setOrnament(check);
    }
  },

  _sliderValueChanged: function(slider, value, id) {
    let stream = this._control.lookup_stream_id(id);
    let volume = value * this._control.get_vol_max_norm();

    stream.volume = volume;
    stream.push_volume();
  },

  _titleToggleState: function(title, event, id) {
    if (event.type() == Clutter.EventType.KEY_PRESS) {
      let symbol = event.get_key_symbol();

      if (symbol != Clutter.KEY_space && symbol != Clutter.KEY_Return) {
        return false;
      }
    }

    let stream = this._control.lookup_stream_id(id);

    stream.change_is_muted(!stream.is_muted);

    return true;
  },

  _notifyVolume: function(object, param_spec, id) {
    let stream = this._control.lookup_stream_id(id);

    this._items[id]["slider"].setValue(stream.volume / this._control.get_vol_max_norm());
  },

  _notifyIsMuted: function(object, param_spec, id) {
    let stream = this._control.lookup_stream_id(id);

    this._items[id]["title"].setToggleState(!stream.is_muted);
  },

  destroy: function() {
    this._control.disconnect(this._streamAddedId);
    this._control.disconnect(this._streamRemovedId);
    this._control.disconnect(this._defaultSinkChangedId);

    this._separator.destroy();
    delete this._separator;

    for (let id in this._outputs) {
      this._outputs[id].destroy();
    }

    // Restore Volume label
    if (USE_OUTPUT_SUBMENU) {
      this._outputMenu.destroy();
      delete this._outputMenu;
    }

    if (panelVolumeMixerHasTitle) {
      let title = new PopupMenu.PopupMenuItem(_("Volume"), {reactive: false });
      let m;
      if (this._mixer._volumeMenu.firstMenuItem['addMenuItem']) {
          m = this._mixer._volumeMenu.firstMenuItem;
      } else {
          m = this._mixer._volumeMenu;
      }
      m.addMenuItem(title, 0);
      title.actor.show();
    }

    // remove application streams
    for (let id in this._items) {
      this._streamRemoved(this._control, id);
    }

    this.emit("destroy");
  }
};


Signals.addSignalMethods(AdvMixer.prototype);


function main() {
  init();
  enable();
}


function init() {
}


function enable() {
  let m = Main.panel.statusArea['volume'];
  if (m === undefined) {
    m = Main.panel.statusArea['aggregateMenu']._volume;
    panelVolumeMixerHasTitle = false;
    actorsHaveUnderscoreMethodNames = true;
  }
  if (m && !advMixer) {
    advMixer = new AdvMixer(m);
  }
}


function disable() {
  if (advMixer) {
    advMixer.destroy();
    advMixer = null;
  }
}

