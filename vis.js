var svg = d3
  .select("#plot")
  .append("svg")
  .attr("id","baselayer")
  .attr("width", 1200)
  .attr("height", 640)
  .call(d3.zoom().on("zoom", function () {
    svg.attr("transform", d3.event.transform)
  }))
  .append("g")
  .attr("id","zoom");

var path = d3.geoPath();

// Set up color scale
var color = d3.scalePow()
  .exponent(0.3)
  .domain([0,6]) // 450^0.3
  .range(d3.schemeReds[5]);

// Set up time scale
var parseDate = d3.timeParse("%Y-%m-%d");
var formatDate = d3.timeFormat("%b %d, %Y");

var start = new Date(parseDate("2020-03-08"));
console.log("Start Date: " + formatDate(start));

var end = new Date(parseDate("2020-07-26"));
console.log("End Date: " + formatDate(end));

var timeScale = d3.scaleTime()
  .domain([start, end])
  .range([0, d3.timeDay.count(start, end)])
console.log("Total number of days: " + d3.timeDay.count(start, end));

// Read data
var promises = [];
promises.push(d3.json("counties-albers-10m.json"));
promises.push(d3.csv("us-counties-covid19-weekly.csv"));

Promise.all(promises).then(function (files) {

  var topo_data = files[0];
  var states = new Map(
    topo_data.objects.states.geometries.map(function (d) {
      return [d.id, d.properties];
    }
    )
  );
  var dataByWeek = d3.nest()
    .key(function (d) { return +d.week; })
    .map(files[1]);

  var dataByCounty = d3.nest()
    .key(function (d) { return d.fips; })
    .map(files[1]);
  // console.log(JSON.stringify(dataByCounty));

  svg.append("g")
  .attr("id", "map")
    .selectAll("path")
    .data(
      topojson.feature(
        topo_data,
        topo_data.objects.counties
      ).features
    )
    .join("path")
    .attr("class", "county")
    .attr("d", path)
    .style("fill", color(0.001));

  svg.select("#map")
    .append("path")
    .style("fill", "none")
    .style("stroke", "white")
    .attr(
      "d",
      path(
        topojson.mesh(
          topo_data,
          topo_data.objects.states,
          function (a, b) {
            return a !== b;
          }
        )
      )
    );

  var tooltip = d3.select("body").append("div")
	.attr("class", "tooltip")
	.style("opacity", 0);

  var factor = 9.255 // #mi^2 = factor * #px^2 (for Harris County, 1777 mi^2 or 192 px^2)
  var legendText = ["0.1", "1", "5", "10", "20", "40"];
  var legendColors = [color(0.1*factor), color(1*factor), color(5*factor), color(10*factor), color(20*factor), color(40*factor)];

  // var legend = svg.append("g")
  //   .attr("id", "legend");
  var legend = d3
    .select("#baselayer")
    .append("g")
    .attr("id", "legend")
    .attr("transform", "translate(0,10)");

  var legenditem = legend.selectAll(".legenditem")
    .data(d3.range(6))
    .enter()
    .append("g")
    .attr("class", "legenditem")
    .attr("transform", function (d, i) { return "translate(" + i * 31 + ",0)"; });

  var offset_x = 715;
  var offset_y = 15;
  legenditem.append("rect")
    .attr("x", offset_x)
    .attr("y", offset_y)
    .attr("width", 30)
    .attr("height", 6)
    .attr("class", "rect")
    .style("fill", function (d, i) { return legendColors[i]; });

  legenditem.append("text")
    .attr("x", offset_x + 15)
    .attr("y", offset_y - 5)
    .style("text-anchor", "middle")
    .text(function (d, i) { return legendText[i]; });
  
  d3.select(".legenditem:nth-child(" + legendText.length + ")")
    .append("g")
    .attr("transform", "translate(25,0)")
    .append("text")
    .attr("x", offset_x + 15)
    .attr("y", offset_y - 5)
    .style("text-anchor", "start")
    .text("(cases/mi²)");

  function update(week) {
    slider.property("value", week);
    d3.select(".week").text("Date: " + formatDate(timeScale.invert((week-10)*7)));

    let data = d3.map();
    for (let value of dataByWeek.get(week)) {
      data.set(value["fips"], {"date" : value["date"], "cases" : value["cases"], "deaths" : value["deaths"]});
    }

    d3.selectAll(".county")
      .style("fill", function (d) {
        // color according to case density
        return (data.has(d.id)) ? color(data.get(d.id).cases/path.area(d)) : color(0.001);
      }
      )
      .on("mouseover", function(d) {
        // Format tooltip message
        let info = (data.has(d.id)) ?
        `
        <p><strong>${d.properties.name}, ${states.get(d.id.slice(0, 2)).name}</strong></p>
        <p>${data.get(d.id).date}</p>
        <table>
        <tbody>
        <tr><td class='wide'>Number of confirmed cases:</td><td>${data.get(d.id).cases}</td></tr>
        <tr><td class='wide'>Number of confirmed deaths:</td><td>${data.get(d.id).deaths}</td></tr>
        <tr><td class='wide'>Death rate:</td><td>${d3.format(".1%")(+data.get(d.id).deaths/+data.get(d.id).cases)}</td></tr>
        </tbody>
        </table>
        <div id="my-scatter"></div>
        ` :
        `
        <p><strong>${d.properties.name}, ${states.get(d.id.slice(0, 2)).name}</strong></p>
        <p>Data not available.</p>
        ` ;
        tooltip.transition()
        .duration(250)
        .style("opacity", 1);
        tooltip.html(info)
        .style("left", (d3.event.pageX + 15) + "px")
        .style("top", (d3.event.pageY - 28) + "px");

        // add scatter plot
        if (dataByCounty.has(d.id)) {
          
          // Set up time series
          let allGroup = ["cases", "deaths"];
          let data_county = allGroup.map( function(grpName) { // .map allows to do something for each element of the list
            return {
              name: grpName,
              values: dataByCounty.get(d.id).map(function(e) {
                return {time: parseDate(e.date), value: +e[grpName]};
              })
            };
          });
          // let data_county = [];
          // for (let value of dataByCounty.get(d.id)) {
          //   // data_county.set(parseDate(value["date"]), { "cases": +value["cases"], "deaths": +value["deaths"] });
          //   data_county.push({ "date" : parseDate(value["date"]),
          //                      "cases" : +value["cases"], 
          //                      "deaths" : +value["deaths"] });
          // }

          // Color scheme
          let myColor = d3.scaleOrdinal()
            .domain(allGroup)
            .range(d3.schemeSet2);

          // Set up plotting area
          let margin = { top: 20, right: 60, bottom: 30, left: 40 },
            width = 300 - margin.left - margin.right,
            height = 200 - margin.top - margin.bottom;

          let svg_county = tooltip.select("#my-scatter")
            .append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform",
              "translate(" + margin.left + "," + margin.top + ")");

          // Add X axis
          let x = d3.scaleTime()
            .domain(d3.extent(data_county[0].values, function (d) { return d.time; }))
            .range([0, width]);
          svg_county.append("g")
            .attr("transform", "translate(0," + height + ")")
            .call(d3.axisBottom(x).ticks(d3.timeSunday.every(4)));
          // Add Y axis
          let y = d3.scalePow()
            .exponent(0.5)
            .domain([0,d3.max(data_county[0].values, function (d) { return d.value; })])
            .range([height, 0]);
          svg_county.append("g")
            .call(d3.axisLeft(y).ticks(6));

          // Add the lines
          let line = d3.line().curve(d3.curveBasis)
            .x(function (d) { return x(+d.time) })
            .y(function (d) { return y(+d.value) })
          svg_county.selectAll("myLines")
            .data(data_county)
            .enter()
            .append("path")
            .attr("d", function (d) { return line(d.values) })
            .style("stroke", function (d) { return myColor(d.name) })
            .style("stroke-width", 4)
            .style("fill", "none")

          // Add the points
          svg_county.selectAll("myDots") // First we need to enter in a group
            .data(data_county)
            .enter()
            .append("g")
            .style("fill", function (d) { return myColor(d.name) })
            .selectAll("myPoints") // Second we need to enter in the 'values' part of this group
            .data(function (d) { return d.values })
            .enter()
            .append("circle")
            .attr("cx", function (d) { return x(d.time) })
            .attr("cy", function (d) { return y(d.value) })
            .attr("r", 5)
            .style("stroke", "white")

          // Add a legend at the end of each line
          svg_county.selectAll("myLabels")
            .data(data_county)
            .enter()
            .append("g")
            .append("text")
            .datum(function (d) { return { name: d.name, value: d.values[d.values.length - 1] }; }) // keep only the last value of each time series
            .attr("transform", function (d) { return "translate(" + x(d.value.time) + "," + y(d.value.value) + ")"; }) // Put the text at the position of the last point
            .attr("x", 12) // shift the text a bit more right
            .text(function (d) { return d.name; })
            .style("fill", function (d) { return myColor(d.name) })
            .style("font-size", 15)
          
          // Highlight selected county
          d3.select(this)
            .style("stroke", "black")
            .raise();
        }
      })
      .on("mouseout", function(d) {
        tooltip.transition()
        .duration(250)
        .style("opacity", 0);
        d3.select(this)
          .style("stroke", "none")
          .lower();
      });
  }

  var slider = d3.select(".slider")
    .append("input")
    .attr("type", "range")
    .attr("min", 10)
    .attr("max", 30)
    .attr("step", 1)
    .on("input", function () {
      var week = this.value;
      update(week);
    });

    // Set the initial date to latest
    update(30);
}
);
