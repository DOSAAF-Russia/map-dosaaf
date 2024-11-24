/* eslint-disable no-unused-vars */
/* global L turf PruneClusterForLeaflet PruneCluster */

import { getSearchControl, LAYER_SWITCHER, set_layer_switcher, set_style_map, setUpEvents, showEcs, showOrgs } from "./main.js";
import { SideBarWidget } from "./widgets.js";


export class AppCache {
    constructor() {
        this._cache = sessionStorage;
    }

    get(key) {
        if (!key || key === "")
            throw new Error("no key specified")
        return this._cache.getItem(key);
    }

    set(key, val) {
        if (!key || key === "")
            throw new Error("no key specified")
        if (!val || val === "")
            throw new Error("no value specified")

        this._cache.setItem(key, val)
    }
}


export class API {
    constructor() {
        this._baseUrl = "/api";
    }

    async _getResponse(endpoint) {
        if (!endpoint || endpoint == "") {
            throw new Error("endpoint must be passed")
        }
        let url = this._baseUrl + endpoint;
        let response = await fetch(url);
        return response;
    }

    async _streamDecode(response, sep = "\n\n") {
        const reader = response.body.getReader();

        let result = '';
        let result_items = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (let item of (new TextDecoder('utf-8').decode(value)).split(sep)) {
                result += item;
                try {
                    let d = JSON.parse(result);

                    result_items.push(d);
                    result = "";
                } catch (e) {
                    console.log(`Handle error in api._streamDecode: ${e}`)
                    continue;
                }
            }
        }

        return result_items;
    }

    async getPolygonsFeatureCollection() {
        let endpoint = "/fd";
        let resp = await this._getResponse(endpoint);
        let response = await this._streamDecode(resp);

        let levels = { "federal_district": [], "regions": [] };

        for (let polygon of response) {
            let polygonName = polygon.name;
            if (!polygonName || !polygonName.toLowerCase().includes("федеральный округ")) {
                continue;
            }

            if (levels["federal_district"].length > 0) {
                let names = new Set(levels["federal_district"].map(item => item.properties.name));
                if (names.has(polygon.name)) {
                    continue;
                }
            }

            if (polygonName.toLowerCase().includes('дальневосточный федеральный округ')) {
                polygon.geojson.coordinates = polygon.geojson.coordinates.filter(polygon =>
                    !polygon.some(part =>
                        part.some(coords => coords.length === 2 && (coords[0] < 0 || coords[1] < 0))
                    )
                );
            }

            let feature = turf.feature(polygon.geojson);
            feature.properties = feature.properties || {};
            feature.properties.name = polygonName;

            levels["federal_district"].push(feature);
        }

        levels["federal_district"].sort((a, b) => turf.area(a) - turf.area(b));

        for (let polygon of response) {
            if (polygon?.name.toLowerCase().includes("федеральный округ")) {
                continue;
            }

            for (let fd_obj of levels["federal_district"]) {
                let names = new Set(levels["regions"].map(item => item.properties.name));
                if (names.has(polygon.name)) {
                    continue;
                }

                let fd_geojson = L.geoJSON(fd_obj);
                let reg_geojson = L.geoJSON(polygon.geojson);

                if (fd_geojson.getBounds().contains(reg_geojson.getBounds())) {
                    let feature = turf.feature(polygon.geojson);
                    feature.properties.federal_district = fd_obj.properties.name;
                    feature.properties.name = polygon.name;
                    levels["regions"].push(feature);
                }
            }
        }

        let obj = {
            "regions": turf.featureCollection(levels["regions"]),
            "federal_districts": turf.featureCollection(levels["federal_district"])
        }
        if (!window._data || Object.keys(window._data).length === 0) {
            window._data = obj;
        }
        return obj;
    }

    getDataFromEC(ec) {
        let data = {
            name: ec.name,
            type_ec: ec.type_ec,

            related_organisations: ec.organisations,

            address: ec.address,
            coords: ec.coords,
            federal_district: ec.federal_district,
            region: ec.region,
        }
        return data
    }

    getDataFromOrg(org) {
        let data = {
            name: org.full_name,
            type_org: org.type_org,

            address: org.address,
            coords: org.coords,
            federal_district: org.federal_district,
            region: org.region,

            phones: org.contact_phones,
            emails: org.contact_emails,
            websites: org.websites,

            ein: org.ein,
            kpp: org.kpp,
            personals: org.personals,
            listorg: org.link_listorg,
        }
        return data
    }

    async getECS() {
        let endpoint = "/ec";
        let resp = await this._getResponse(endpoint);
        let response = await this._streamDecode(resp);

        let datas = [];
        for (let ec of response[0]) {
            let coords = [0, 0];
            if (ec.coords && ec.coords[0]) {
                coords = ec.coords[0].split(',').map(num => parseFloat(num.trim()));
            }

            let names = new Set(datas.map(i => i.name))
            let dataObject = this.getDataFromEC(ec);

            if (names.has(dataObject.name)) {
                continue;
            }
            dataObject.coords = coords;

            let type_ec = ec.type_ec;
            if (type_ec.toLowerCase().includes("зональный")) {
                type_ec = 'ЗЦ';
            } else if (type_ec.toLowerCase().includes("региональный")) {
                type_ec = 'РЦ';
            }
            else {
                throw new Error(`Unknown type_ec: ${ec.type_ec} ${ec}`);
            }

            datas.push(dataObject);
        }

        return datas;
    }

    async getOrganisations() {
        let endpoint = "/organizations";
        let resp = await this._getResponse(endpoint);
        let response = await this._streamDecode(resp);

        let datas = [];
        for (let org of response[0]) {
            let coords = [0, 0];
            if (org.coords && org.coords[0]) {
                coords = org.coords[0].split(',').map(num => parseFloat(num.trim()));
            }

            let names = new Set(datas.map(i => i.name))
            let dataObject = this.getDataFromOrg(org);

            if (names.has(dataObject.name)) {
                continue;
            }
            dataObject.coords = coords;
            datas.push(dataObject);
        }

        return datas;
    }
}



export class Config {
    static INITIAL_ZOOM = 3;
    static INITIAL_COORDS = [63.31122971681907, 92.47689091219665];
}

export var DISABLE_TILE_COLORS_RENDERING = false;


export class MarkerClusters {
    constructor() {
        this._clusters = {};
    }

    addMarkerCluster(name, markerCluster) {
        if (!name || name === "") {
            throw new Error("name must be passed")
        }
        if (!markerCluster) {
            throw new Error("markerCluster must be passed")
        }
        this._clusters[name] = markerCluster;
    }

    getCluster(name) {
        if (!name || name === "") {
            throw new Error("name must be passed")
        }
        return this._clusters[name];
    }

    getClusters() {
        return this._clusters;
    }

    clearCluster(cluster, map=null) {
        cluster.RemoveMarkers();
        cluster.ProcessView();

        if (map) {
            map.removeLayer(cluster);
        }
    }

    removeMarkerFromCluster(cluster, marker, map) {
        if (!cluster) {
            throw new Error("cluster must be passed")
        }
        if (!marker) {
            throw new Error("marker must be passed")
        }

        cluster.RemoveMarkers([marker]);
        cluster.ProcessView();

        if (map) {
            map.removeLayer(marker);
        }
    }
}


export class Utils {

    replaceSpacesOnString(str, separator = "_") {
        return str.replace(/ /g, separator);
    }
}


export class OrganisationsUtils {
    constructor(cache) {
        if (!cache) {
            throw new Error("cache must be passed")
        }
        this._cache = cache;
    }

    getOrgsTypes() {
        let orgs = JSON.parse(this._cache.get("orgs"));
        let types = new Set(orgs.map(i => i.type_org));
        return types;
    }

    getOrgsByType(type) {
        let orgs = JSON.parse(this._cache.get("orgs"));
        return orgs.filter(i => i.type_org === type);
    }
}


export class MapUtils {
    constructor(map) {
        let cache = new AppCache();
        let markerClusterManager = new MarkerClusters();

        this._map = map;
        this._cache = cache;
        this.highlight = null;
        this._api = new API();

        let clusters = Object.values(markerClusterManager.getClusters());
        if (clusters.length === 0) {
            let clusterEcs = this.buildMarkersCluster();
            let clusterOrgs = this.buildMarkersCluster(160);
            clusterEcs.addTo(this._map);
            clusterOrgs.addTo(this._map);
            
            markerClusterManager.addMarkerCluster("ecs", clusterEcs);
            markerClusterManager.addMarkerCluster("orgs", clusterOrgs);

        } else {
            throw new Error(`map should be not have marker cluster group, but it have: ${clusters.length}`)
        };

        this._markerClusterManager = markerClusterManager;

        this._sidebar = new SideBarWidget();
        this._sidebar.get().addTo(this._map);
        this._all_features = [];
    }

    _closeFederalDistricts() {
        this._map.eachLayer((layer) => {
            const properties = layer.feature?.properties;
            if (!properties || !properties.name.toLowerCase().includes("федеральный округ")) {
                return;
            }
            this._map.removeLayer(layer)
        })

    }
    
    buildMarkersCluster(n = 100) {
        let cluster = new PruneClusterForLeaflet(n);

        var prepareMarkerFunc = cluster.PrepareLeafletMarker
        cluster.PrepareLeafletMarker = function(leafletMarker, data) {

            if (data.callbacks) {
                for (let [event, callback] of Object.entries(data.callbacks)) {
                    leafletMarker.on(event, callback)
                }
            }

            if (data.custom_data) {
                leafletMarker.custom_data = data.custom_data;
            }

            prepareMarkerFunc(leafletMarker, data)
        };

        return cluster;
    }

    getMarkerClustersFromMap() {
        var markerClusters = [];
        this._map.eachLayer((layer) => {
            if (!(layer instanceof PruneClusterForLeaflet)) {
                return
            }
            markerClusters.push(layer)
        })
        return markerClusters;
    }

    removeMarkerClusters() {
        this._map.eachLayer((layer) => {
            if (!(layer instanceof PruneClusterForLeaflet)) {
                return
            }
            this._map.removeLayer(layer);
        })
    }

    buildMarker(coords, markerOptions = {}, callbacks = null, custom_data = null) {
        let marker = new PruneCluster.Marker(coords[0], coords[1], markerOptions);
        if (callbacks) {
            marker.data.callbacks = callbacks;
        }
        if (custom_data) {
            marker.custom_data = custom_data;
        }
        return marker;
    }

    addMarker(marker, markerCluster) {
        markerCluster.RegisterMarker(marker);
        markerCluster.ProcessView();
    }

    _federalDistrictCallback(name, bounds) {
        this._map.fitBounds(bounds);
        this._closeFederalDistricts()

        let features = this._cache.get("features");
        let regions = [];
        for (let regionFeature of JSON.parse(features)["regions"].features) {
            if (regionFeature.properties.federal_district !== name) {
                continue;
            }
            regions.push(regionFeature)
        }
        this.addGeojson(turf.featureCollection(regions))
    }

    _regionCallback(name, bounds) {
        console.log(name);
        this._map.fitBounds(bounds);
        DISABLE_TILE_COLORS_RENDERING = !DISABLE_TILE_COLORS_RENDERING;
    }

    _polygonCallback(e) {
        const layer = e.layer;
        const properties = layer.feature?.properties;
        if (!properties) {
            return
        }
        if (properties.name?.toLowerCase().includes("федеральный округ")) {
            this._federalDistrictCallback(properties.name, layer.getBounds());
        } else {
            this._regionCallback(properties.name, layer.getBounds());
        }
    }


    clearHighlight() {
        if (this.highlight) {
            this.highlight.setStyle({
                fillColor: "transparent",
                fillOpacity: 0.5,
                fill: true,
                color: 'black',
                weight: 1.5,
            });
        }
        this.highlight = null;
    }

    _polygonMouseCallback(e) {
        if (DISABLE_TILE_COLORS_RENDERING) {
            return
        }

        var properties = e.layer.feature.properties;
        if (properties.closed === true) {
            return;
        }
        if (this.highlight !== e.layer) {
            L.popup()
                .setContent(properties.name)
                .setLatLng(e.latlng)
                .openOn(this._map);
        }
        this.clearHighlight();
        this.highlight = e.layer;
        var style = {
            fillColor: '#ec0f0f',
            fillOpacity: 0.2,
            stroke: true,
            fill: true,
            color: 'red',
            opacity: 1,
            weight: 2,
        };
        e.layer.setStyle(style);
    }

    resetMapStyle() {
        let clusters = this._markerClusterManager.getClusters();
        this._map.eachLayer((layer) => {
            // if (layer instanceof L.TileLayer) {
            //     return;
            // }

            if (layer instanceof PruneClusterForLeaflet) {
                return
            }

            this._map.removeLayer(layer);
        })

        for (let cluster of Object.values(clusters)) {
            this._markerClusterManager.clearCluster(cluster, this._map);
        }
        this.clearHighlight();
    }

    addGeojson(geojson, fillColor = "transparent", strokeColor = "black") {
        let clickCallback = this._polygonCallback.bind(this)
        let mouseCallback = this._polygonMouseCallback.bind(this)
        const map = this._map;
        let geojsonLayer = L.geoJSON(geojson, {
            style: function (e) {
                return {
                    "fillColor": fillColor,
                    "weight": 1.5,
                    "color": strokeColor
                }
            }
        })
            .on("click", clickCallback)
            .on('mouseover', mouseCallback)
            .addTo(map);
        
        var features = [];
        for (let feature of geojsonLayer.toGeoJSON().features) {
            feature = turf.centroid(feature.geometry)
            // feature = turf.feature(feature.geometry.coordinates, feature.properties);
            // let point = turf.point(feature.geometry.coordinates, feature.properties);
            features.push(feature)
        }

        this._all_features.push(...features)
    }

    getLayerSwitcher() {
        // let osm = L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        //     maxZoom: 20,
        //     subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        // }).addTo(this._map);
        let osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(this._map);
        let google = L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{
            maxZoom: 20,
            subdomains:['mt0','mt1','mt2','mt3']
        });
        let hybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        });

        let baseTree = {
            label: "Вид карты",
            children: [
                {
                    label: "Схема",
                    layer: osm,
                },
                {
                    label: "Улицы",
                    layer: google,
                },
                {
                    label: "Гибрид",
                    layer: hybrid,
                }
            ]
        };

        let categorizedOrgs = {};
        for (let org of JSON.parse(this._cache.get("orgs"))) {
            if (!categorizedOrgs[org.type_org]) {
                categorizedOrgs[org.type_org] = [];
            }
            categorizedOrgs[org.type_org].push(org);
        }

        let childrenCategorizedOrgs = [];
        for (let [categoryName, orgs] of Object.entries(categorizedOrgs)) {
            
            let formattedCategoryName = categoryName;
            if (categoryName == "null") {
                formattedCategoryName = "Неизвестно"
            }
            categoryName = categoryName.replace(/ /g, "^");

            let obj = {
                label: `<span id="toggler-category-org" category="${categoryName}">${formattedCategoryName}</span>`,
                layer: L.layerGroup(),
            }

            childrenCategorizedOrgs.push(obj)
        }

        let ecs = this._markerClusterManager.getCluster("ecs");
        let overlayTree = {
            label: "Точки на карте",
            selectAllCheckbox: true,
            children: [
                {
                    label: `Единые центры`,
                    layer: ecs,
                },
                {
                    label: "<span id='toggler-main-org'>Организации</span>",
                    
                    layer: L.layerGroup(),
                    children: childrenCategorizedOrgs,
                    collapsed: true
                }
            ]
        }

        let switcher = L.control.layers.tree(
            baseTree, overlayTree,
            { collapsed: false }
        );
        switcher.setOverlayTree(overlayTree).collapseTree(true).expandSelected(true)

        return switcher
    }

    getResetMapButton() {
        return L.easyButton('fa-rotate', function() {
            this.resetMapStyle();

            this._sidebar.hide();
            let features = JSON.parse(this._cache.get("features"));
            this.addGeojson(features.federal_districts);

            Object.values(this._markerClusterManager.getClusters()).forEach(cluster => {
                // this._map.removeLayer(cluster)
                cluster.addTo(this._map)
            });

            showEcs();
            // showOrgs(); 
            // this.removeOrganisations();
            this._map.removeControl(LAYER_SWITCHER);
            let layer_switcher = this.getLayerSwitcher();
            layer_switcher.addTo(this._map);
            set_layer_switcher(layer_switcher);
            
            setUpEvents();
            DISABLE_TILE_COLORS_RENDERING = false;
            this._map.setView(Config.INITIAL_COORDS, Config.INITIAL_ZOOM)
        }.bind(this))
    }

    /*         THIS IS A CUSTOM (VAR) FUNCTIONS          */

    /**
     * @param {{ 
    *     full_name: string, 
    *     type_org: string, 
    *     address: string, 
    *     coords: Array<number>, 
    *     federal_district: string, 
    *     region: string, 
    *     contact_phones: Array<string>, 
    *     contact_emails: Array<string>, 
    *     websites: Array<string>, 
    *     ein: string, 
    *     kpp: string, 
    *     personals: Array<string>, 
    *     link_listorg: string 
    * }} org - объект организации
    */
    addOrganisation(org = null, add = true) {
        if (!org) {
            throw new Error("organisation object must be passed")
        }
        
        let callback = (e) => {this._expandOrgCallback(e, org)}
        let marker = this.buildMarker(org.coords, {
            callbacks: {"click": callback},
            custom_data: org
        });
        let cluster = this._markerClusterManager.getCluster("orgs");
        if (!cluster) {
            throw new Error("no cluster for orgs")
        }

        if (add) {
            this.addMarker(marker, cluster);
        }
        this._all_features.push(turf.feature(org.coords, org))
        return marker
    }

    removeOrganisations() {
        let cluster = this._markerClusterManager.getCluster("orgs");
        if (!cluster) {
            throw new Error("no cluster for orgs")
        }

        this._markerClusterManager.clearCluster(cluster);
    }

    removeOrganisation(org) {
        let cluster = this._markerClusterManager.getCluster("orgs");
        if (!cluster) {
            throw new Error("no cluster for orgs")
        }

        let clusterManager = this._markerClusterManager;
        if (!cluster.GetMarkers().map((marker) => {return marker.data.custom_data}).some(data => data.ein === org.ein)) {
            return;
        }

        for (let marker of cluster.GetMarkers()) {
            if (marker.data.custom_data.ein === org.ein) {
                clusterManager.removeMarkerFromCluster(cluster, marker);
            }
        }
    }
    
    removeEcs() {
        let cluster = this._markerClusterManager.getCluster("ecs");
        if (!cluster) {
            throw new Error("no cluster for ecs")
        }

        this._markerClusterManager.clearCluster(cluster);
    }

    _expandOrgCallback(e, orgData) {
        let sidebar = this._sidebar;
        let org = orgData;
        sidebar.hide()
        
        let data = {
            "Тип организации": org.type_org,
            "ИНН организации": org.ein,
            "КПП организации": org.kpp,
            "Кол-во персонала": org.personals || "Нету данных",
            "Регион": org.region,
            "Федеральный округ": org.federal_district,
            "Адрес": org.address,
            "Координаты": org.coords,
        }
        
        let contactsData = {
            "Телефон": (org.phones && org.phones.length > 0) ? org.phones.join(", ") : "Нету данных",
            "Почта": (org.emails && org.emails.length > 0) ? org.emails.join(", ") : "Нету данных",
            "Сайт": org.websites[0] ?
                `<a href="${org.websites[0]}" target="_blank">${org.websites[0]}</a>` :
                "Нету данных",
            "Профиль на ListOrg": org.listorg ? 
                `<a href="${org.listorg}" target="_blank">
                    <button class="data-button">Открыть профиль</button>
                </a>` : 
                "Нету данных",
        }

        sidebar.get().setContent(
            `
            <div style="display: flex; flex-direction: column; height: 100%;">
                <h3>${org.name}</h3>
                <h3>Основная информация</h3>
                <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                    ${Object.entries(data).map(([key, value]) => `
                        <div class="data-row">
                            <span class="data-key">${key}:</span>
                            <span class="data-value">${value}</span>
                        </div>
                    `).join('')}
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <a href="https://yandex.ru/maps?mode=search&text=${org.coords}" target="_blank" style="text-decoration: none;">
                            <button class="data-button">Открыть на Яндекс.Картах</button>
                        </a>
                        <a href="https://2gis.ru/search/${org.coords}" target="_blank" style="text-decoration: none;">
                            <button class="data-button">Открыть в 2GIS</button>
                        </a>
                        <a href="https://pkk.rosreestr.ru/#/search/50.39212997282373,127.5592176766207/11/@541ls89ah?text=${org.coords}&type=1" target="_blank" style="text-decoration: none;">
                            <button class="data-button">Открыть кадастровую карту</button>
                            </a>
                    </div>
                </div>

                <h3>Контактная информация</h3>
                <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                    ${Object.entries(contactsData).map(([key, value]) => `
                        <div class="data-row">
                            <span class="data-key">${key}:</span>
                            <span class="data-value">${value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            `
        )
        sidebar.show();
    }

    _expandEcCallback(e, dataObject) {
        let sidebar = this._sidebar;

        if (sidebar.isVisible()) {
            sidebar.hide()
        }

        let data = {
            "Тип": dataObject.type_ec,
            "Адрес": dataObject.address,
            "Регион": dataObject.region,
            "Федеральный округ": dataObject.federal_district,
            "Координаты": dataObject.coords,
        }

        sidebar.get().setContent(
            `
            <div style="display: flex; flex-direction: column; height: 100%;">
                <h3>${dataObject.name}</h3>
                <div style="width: 100%; border-collapse: collapse; flex-grow: 1;">
                    ${Object.entries(data).map(([key, value]) => `
                        <div class="data-row">
                            <span class="data-key">${key}:</span>
                            <span class="data-value">${value}</span>
                        </div>
                    `).join('')}
                    
                </div>
                <div style="display: flex; flex-direction: row; gap: 10px;">
                        <a href="https://yandex.ru/maps?mode=search&text=${dataObject.coords}" target="_blank" style="text-decoration: none;">
                            <button class="data-button">Открыть на Яндекс.Картах</button>
                        </a>
                        <a href="https://2gis.ru/search/${dataObject.coords}" target="_blank" style="text-decoration: none;">
                            <button class="data-button">Открыть в 2GIS</button>
                    </a>
                </div>
                
                <div style="padding: 10px; text-align: center;">
                    <button id="organisations_viewer" class="data-button">Привязанные организации (${dataObject.related_organisations.length})</button>
                </div>
            </div>
            `
        )
        sidebar.show()
        document.getElementById("organisations_viewer").onclick = (e) => {
            let allOrgs = JSON.parse(this._cache.get("orgs"));
            let organisations = allOrgs.filter(org => dataObject.related_organisations.includes(org.ein));
            sidebar.hide()

            DISABLE_TILE_COLORS_RENDERING = true;
            this.removeOrganisations();
            this.removeEcs();
            this.clearHighlight()

            let coordinates = [];
            for (let org of organisations) {
                this.addOrganisation(org);
                coordinates.push(org.coords);
            }

            let bounds = L.latLngBounds(coordinates.map(coords => L.latLng(coords)));
            this._map.fitBounds(bounds);
        }
    }

    /**
     * @param {{ 
    *     name: string, 
    *     type_ec: string, 
    *     related_organisations: Array<string>, 
    *     address: string, 
    *     coords: Array<number>, 
    *     federal_district: string, 
    *     region: string 
    * }} ec - объект единого центра
    */
    addEc(ec = null, add = true, custom_cluster = null) {
        if (!ec) {
            throw new Error("ec object must be passed")
        }

        let type_ec = ec.type_ec;
        let backgroundColor;
        if (type_ec.toLowerCase().includes("зональный")) {
            type_ec = 'ЗЦ';
            backgroundColor = 'rgb(49, 161, 64)';
        } else if (type_ec.toLowerCase().includes("региональный")) {
            type_ec = 'РЦ';
            backgroundColor = 'rgba(246, 53, 39, 0.78)';
        }
        else {
            throw new Error(`Unknown type_ec: ${ec.type_ec} ${ec}`);
        }

        let markerOptions = {
            icon: L.BeautifyIcon.icon({
                isAlphaNumericIcon: true,
                text: type_ec,
                textColor: 'white',
                borderColor: 'black',
                backgroundColor: backgroundColor,
                customClasses: 'ec-marker',
                iconSize: [30, 30],
                borderWidth: 1,
            }),
        }
        let callback = (e) => this._expandEcCallback(e, ec);
        let marker = this.buildMarker(ec.coords, markerOptions, {"click": callback})

        let cluster;
        if (!custom_cluster) {
            cluster = this._markerClusterManager.getCluster("ecs");
            if (!cluster) {
                throw new Error("no cluster for ecs")
            }
        } else {
            cluster = custom_cluster;
        }

        if (add) {
            this.addMarker(marker, cluster);
        }
        this._all_features.push(turf.feature(ec.coords, ec))
        return marker
    }

}
