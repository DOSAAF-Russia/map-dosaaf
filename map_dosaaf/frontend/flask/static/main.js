/* eslint-disable no-unused-vars */
/* global L Fuse turf */

import { Config, AppCache, API, MapUtils, OrganisationsUtils } from "./utils.js";


const api = new API();
var map = L.map("map");
export const mapUtils = new MapUtils(map);
const cache = new AppCache();
window.mapUtils = mapUtils;
export const CACHE_KEYS = {
    "features": async () => {return await api.getPolygonsFeatureCollection()},
    "ecs": async () => {return await api.getECS()},
    "orgs": async () => {return await api.getOrganisations()}
};


async function setUpCache() {
    // const cache = new AppCache();
    for (let [key, method] of Object.entries(CACHE_KEYS)) {
        let val = cache.get(key);
        if (!val) {
            val = await method();
            cache.set(key, JSON.stringify(val));
        } else {
            val = JSON.parse(val);
        }
    }
}


export function showEcs() {
    // const cache = new AppCache();

    let ecs = JSON.parse(cache.get("ecs"));
    for (const ec of ecs) {
        mapUtils.addEc(ec);
    }
}

export function showOrgs() {
    // const cache = new AppCache();

    let orgs = JSON.parse(cache.get("orgs"));
    for (const org of orgs) {
        mapUtils.addOrganisation(org);
    }
}


export function getExistingOrgsOnMap() {
    let existing_orgs = [];
    for (let cluster of mapUtils.getMarkerClustersFromMap()) {
        for (let marker of cluster.GetMarkers()) {
            let obj = marker.data.custom_data;
            if (obj) {
                existing_orgs.push(obj);
            }
        }
    }
    return existing_orgs;
}

export function setUpEvents() {
    // const cache = new AppCache();
    map.on("click", () => {mapUtils.clearHighlight()})

    function toggleVisibilityOrgs(orgs, isVisible) {
        let existing_orgs = getExistingOrgsOnMap();

        if (!isVisible) {
            if (orgs.length > 0) {
                for (let org of orgs) {
                    if (!existing_orgs.some(existingOrg => existingOrg.ein === org.ein)) {
                        mapUtils.addOrganisation(org);
                    }
                }
            }
        } else {
            for (let org of orgs) {
                mapUtils.removeOrganisation(org);
            }
        }
    }

    document.querySelector("#toggler-main-org").parentElement.parentElement.addEventListener("click", (e) => {
        if (e.pointerId === -1) {
            return;
        }
        console.log(e);
        let isVisible = document.querySelector("#toggler-main-org").parentElement.parentElement.querySelector('input').checked;
        if (e.target.tagName === "INPUT") {
            isVisible = !isVisible;
        }

        let orgs = JSON.parse(cache.get("orgs"));
        toggleVisibilityOrgs(orgs, isVisible);
        
        e.stopPropagation();
        });
        
    for (let el of document.querySelectorAll("#toggler-category-org")) {
        var element = el.parentElement.parentElement;
        element.addEventListener("click", (e) => {
            let orgs_utils = new OrganisationsUtils(cache);
            let raw_typeOrgs = el.getAttribute("category");
            let typeOrgs = raw_typeOrgs.replace(/\^/g, " ");

            if (typeOrgs === "null") {
                typeOrgs = null;
            }

            let allOrgs = orgs_utils.getOrgsByType(typeOrgs);
            let isVisible = el.parentElement.parentElement.querySelector('input').checked;
            if (e.target.tagName === "INPUT") {
                isVisible = !isVisible;
            }
            
            let orgs = [];
            for (let org of allOrgs) {
                orgs.push(org);
            }

            toggleVisibilityOrgs(orgs, isVisible);

            e.stopPropagation();
        })
    }
}


export function getSearchControl() {
    function localData(text, callResponse) {
        callResponse(text);

        return {
            abort: function() {
                console.log('aborted search request:'+ text);
            }
        };
    }
    var markers = [];
    var markersKeys = new Set();

    for (let org of JSON.parse(cache.get("orgs"))) {
        let feature = L.marker(org.coords).toGeoJSON();
        feature.coords = org.coords;
        feature.properties = org;
        markers.push(feature);
        Object.keys(org).forEach(key => markersKeys.add(`properties.${key}`));
        
    }

    // var clusters = mapUtils.getMarkerClustersFromMap();
    // for (let cluster of clusters) {
    //     for (let marker of cluster.GetMarkers()) {
    //         let data = marker.data.custom_data;
    //         if (!data) {
    //             continue;
    //         }

    //         let feature = L.marker(data.coords).toGeoJSON();
    //         feature.coords = data.coords;
    //         feature.properties = data;
    //         markers.push(feature);
    //         Object.keys(data).forEach(key => markersKeys.add(`properties.${key}`));
    //     }
    // }
    
    var fuse = new Fuse(markers, {
        keys: Array.from(markersKeys),
    });
    function filterData(text, records) {
        var jsons = fuse.search(text),
            ret = {}, key, obj;
        
        for(var i in jsons) {
            i = Number(i);
            obj = jsons[i].item;
            key = obj.properties.name;
            ret[ key ] = L.latLng(obj.coords);
        }

        console.log(jsons,ret);
        return ret;
    };

    let control = new L.Control.Search({
        sourceData: localData,
        filterData: filterData,
        formatData: function(text) {
            let res = filterData(text);
            return res;
        },
        moveToLocation: function(latlng, title, map) {
            let bounds = L.latLngBounds([latlng, latlng]);
            map.fitBounds(bounds);
        },
        autoCollapseTime: 5000,
        hideMarkerOnCollapse: true
    });

    return control
}


export var LAYER_SWITCHER;
export function set_layer_switcher(layer_switcher) {
    LAYER_SWITCHER = layer_switcher;
}


export function set_style_map() {
    let features = JSON.parse(cache.get("features"));
    mapUtils.addGeojson(features.federal_districts)
    map.setView(Config.INITIAL_COORDS, Config.INITIAL_ZOOM);

    let resetBtn = mapUtils.getResetMapButton();
    LAYER_SWITCHER.addTo(map);
    resetBtn.addTo(map);
    
    showEcs();
    // showOrgs();
    // mapUtils.removeOrganisations();
    setUpEvents();

    getSearchControl().addTo(map);
}


async function main() {
    document.querySelector(".leaflet-control-attribution").remove();
    await setUpCache();
    LAYER_SWITCHER= mapUtils.getLayerSwitcher()
    set_style_map()
}


document.addEventListener("DOMContentLoaded", () => {
    main();
});
