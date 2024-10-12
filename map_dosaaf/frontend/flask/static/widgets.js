/* global L */


export class SideBarWidget {
    constructor() {
        this._sidebar = L.control.sidebar('sidebar', {
            position: 'right'
        });
    }

    get() {
        return this._sidebar;
    }

    show() {
        this._sidebar.show();
    }

    hide() {
        this._sidebar.hide();
    }

    isVisible() {
        this._sidebar.isVisible();
    }

    toggle() {
        this._sidebar.toggle();
    }
}


