var map = L.map('map', {
    // preferCanvas: true,
    // renderer: L.canvas()
}).setView({{ center }}, {{ zoom }});
window._data = {};



class FederalDistrictLoader {
    constructor(map) {
        this.map = map;
        this._raw_result = null;
    }

    async _load() {
        const response = await fetch("/api/fd");
        const reader = response.body.getReader();

        let result = '';
        let result_items = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (let item of (new TextDecoder('utf-8').decode(value)).split('\n\n')) {
                result += item;
                try {
                    let d = JSON.parse(result);

                    result_items.push(d);
                    result = "";
                } catch (e) { }
            }
        }

        this._raw_result = result_items;
    }

    _process_raw_result() {
        if (!this._raw_result) {
            throw new Error("API Response is empty. Try to load data first");
        }

        let unionPolygons = [];
        let levels = { "federal_district": [], "regions": [] };

        for (let d of this._raw_result) {
            let names = new Set(levels["federal_district"].map(item => item.name));
            if (names.has(d.name)) {
                continue;
            }
            if (d.name.toLowerCase().includes("федеральный округ")) {
                let polygon = d.geojson;
                if (!polygon.properties) {
                    polygon.properties = {};
                }
                polygon.properties.name = d.name;

                let obj = {
                    name: d.name,
                    polygon: polygon,
                }

                levels["federal_district"].push(obj);
                unionPolygons.push(polygon);
            } else {
                let names = new Set(levels["regions"].map(item => item.name));
                if (names.has(d.name)) {
                    continue;
                }
                levels["regions"].push(d);
            }
        }

        let processedRegions = [];
        for (let fd_obj of levels["federal_district"]) {
            for (let d of levels["regions"]) {
                let names = new Set(processedRegions.map(item => item.name));
                if (names.has(d.name)) {
                    continue;
                }

                let fd_geojson = L.geoJSON(fd_obj.polygon);
                let reg_geojson = L.geoJSON(d.geojson);

                let obj = {
                    name: d.name,
                    polygon: d.geojson,
                }
                if (fd_geojson.getBounds().contains(reg_geojson.getBounds())) {
                    obj.federal_district = fd_obj.name;
                }
                else { continue; }

                if (!obj.polygon.properties) {
                    obj.polygon.properties = {};
                }
                obj.polygon.properties = { name: obj.name, federal_district: obj.federal_district };
                processedRegions.push(obj);
            }
        }

        levels["regions"] = processedRegions;
        if (!window._data || Object.keys(window._data).length === 0) {
            window._data = levels;
        }

        for (let fd of levels["federal_district"]) {
            let p = fd.polygon;
            L.geoJSON(p).addTo(map).on("click", function(e) {
                let props = e.layer.feature.geometry.properties;
                console.log(`fd: ${props.name}`);
            });
        }

        for (let region of processedRegions) {
            let p = region.polygon;
            L.geoJSON(p).addTo(map).on("click", function(e) {
                let props = e.layer.feature.geometry.properties;
                console.log(`region: ${props.name} fd: ${props.federal_district}`);
            });
        }
        

        return featureCollection;
    }


    async getFeatureCollection(simplify = false) {
        if (!this._raw_result) {
            await this._load();
        }
        let featureCollection = this._process_raw_result();
        if (simplify) {
            featureCollection = turf.simplify(featureCollection, { tolerance: 0.01, highQuality: true });
        }
        return featureCollection;
    }
}


var fd_loader = new FederalDistrictLoader(map);


function objectToString(obj) {
    let result = '';
    for (let [key, value] of Object.entries(obj)) {
        if (!value) {
            value = '';
        };
        result += `${key}: ${value}<br>`;
    }
    return result.trim();
}


function getDataFromOrg(org) {
    let data = {
        name: org.full_name,
        type_org: org.type_org,

        address: org.address,
        coords: org.coords,
        federal_district: org.federal_district,
        region: org.region,

        phones: org.phones,
        emails: org.emails,
        websites: org.websites,

        ein: org.ein,
        kpp: org.kpp,
        personals: org.personals,
        listorg: org.link_listorg,
    }
    return data
}

function getDataFromEC(ec) {
    let data = {
        name: ec.name,
        type_ec: ec.type_ec,

        related_organisations: ec.organisations,
        type_ec: ec.type_ec,

        address: ec.address,
        coords: ec.coords,
        federal_district: ec.federal_district,
        region: ec.region,
    }
    return data
}


async function getOrgs(eins = null) {
    let response = await fetch(`/api/organizations?eins=${eins}`);
    let organizations = await response.json();
    return organizations;
}


async function loadOrganizations(organisations) {

    for (let organization of organisations) {
        // load coordinates
        let coords = [0, 0];
        if (organization.coords && organization.coords[0]) {
            coords = organization.coords[0].split(',').map(num => parseFloat(num.trim()));
        }

        // load display data
        let dataObject = getDataFromOrg(organization);
        let dataString = objectToString(dataObject);

        let marker = L.marker(coords);
        marker.bindPopup(dataString).openPopup();
        marker.bindTooltip(dataObject.name);
        marker.addTo(window._markers);
    }
    //markers.addTo(map);
}


async function loadEC() {
    let response = await fetch('/api/ec');
    let ecs = await response.json();

    for (let ec of ecs) {
        // load coordinates
        let coords = [0, 0];
        if (ec.coords && ec.coords[0]) {
            coords = ec.coords[0].split(',').map(num => parseFloat(num.trim()));
        }

        // load display data
        let dataObject = getDataFromEC(ec);
        let dataString = objectToString(dataObject);

        let type_ec = ec.type_ec;
        if (type_ec.toLowerCase().includes("зональный")) {
            type_ec = 'ЗЦ';
        } else if (type_ec.toLowerCase().includes("региональный")) {
            type_ec = 'РЦ';
        }
        else {
            throw new Error(`Unknown type_ec: ${ec.type_ec} ${ec}`);
        }

        let marker = L.marker(coords, {
            icon: L.BeautifyIcon.icon({
                isAlphaNumericIcon: true,
                text: type_ec,
                textColor: 'black',
                borderColor: 'black',
                backgroundColor: 'white',
                customClasses: 'ec-marker',
                iconSize: [30, 30],
                borderWidth: 1
            }),
        })

        let popup = ecPopup(dataObject.name, dataString, ec.organisations);

        marker.bindPopup(popup);
        marker.bindTooltip(dataObject.name);
        marker.addTo(window._markers);
    }
}


async function loadFD() {
    let featureCollection = await fd_loader.getFeatureCollection();
    // L.vectorGrid.slicer(featureCollection, {
    //     rendererFactory: L.svg.tile,
    //     vectorTileLayerStyles: {
    //         sliced: function(properties, zoom) {
    //             return {
    //                 fillColor: "transparent",
    //                 fillOpacity: 0.5,
    //                 stroke: true,
    //                 fill: true,
    //                 color: 'black',
    //                 weight: 2,
    //             }
    //         }
    //     },
    //     interactive: true,
    // }).addTo(map).on("click", function(e) {
    //     console.log(e.layer.properties.name);
    // });

    // L.geoJSON(featureCollection, {
    //     style: function (feature) {
    //         return {
    //             color: 'black',
    //             weight: 2,
    //             fillOpacity: 0
    //         };
    //     }
    // }).addTo(map);

    // L.glify.shapes({
    //     map: map,
    //     data: simplified,
    // });
}


async function loadMD() {
    const response = await fetch("/api/md");
    const reader = response.body.getReader();

    let result = '';
    let result_items = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (let item of (new TextDecoder('utf-8').decode(value)).split('\n\n')) {
            result += item;
            try {
                let d = JSON.parse(result);
                result = "";
            } catch (e) { }
        }
    }
}


async function loadPolygons() {
    await loadFD();
    //await loadMD();
}


async function loadMarkers() {
    await loadEC();
}


function ecPopup(title, content, relatedOrgsEins = null) {
    let popup = L.popup({
        closeButton: false,
        autoClose: false,
        className: 'ec-popup'
    })
        .setContent(`
        <div class="popup-title">${title}</div>
        <div class="popup-content">${content}</div>
        <button class="popup-close-btn">Закрыть</button>
    `);

    popup.on('add', async function (e) {
        e.target.getElement().querySelector('.popup-close-btn').addEventListener('click', async function () {
            map.closePopup(popup);
        });
    });

    return popup;
}


async function loadRelatedOrgsPopup(releatedOrgsEins) {
    const params = new URLSearchParams();
    if (releatedOrgsEins) {
        releatedOrgsEins.forEach(ein => params.append('ein', ein));
    }

    let response = await fetch(`/api/organizations?${params.toString()}`);
    let organizations = await response.json();
    await loadOrganizations(organizations);
}


function hideAllMarkers(curr = null) {
    map.eachLayer(function (layer) {
        if (layer instanceof L.Marker && layer !== curr) {
            layer.setOpacity(0);
        }
    });
}


async function loadTileTogler() {

    new L.basemapsSwitcher([
        {
            layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '<a href="https://osm.org/copyright">OpenStreetMap contributors</a>'
            }).addTo(map),
            icon: "{{ url_for('static', filename='map.png')}}",
            name: 'Схема'
        },
        {
            layer: L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
            }),
            icon: "{{ url_for('static', filename='map-hybrid.png')}}",
            name: 'Гибрид'
        },
    ], { position: 'topright' }).addTo(map);

}


async function main() {
    await loadTileTogler();
    // window._markers = L.markerClusterGroup();
    // window._markers.addTo(map);
    //await loadMarkers();
    await loadPolygons();
}

main();