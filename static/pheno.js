
$.getJSON("/api/pheno/" + window.pheno + ".json").done(function(variants) {
    window.variants = variants;
    $(create_gwas_plot);
});

var get_chrom_offsets = _.memoize(function() {
    var chrom_padding = 1e7;
    var chrom_lengths = {};
    window.variants.forEach(function(variant) {
        if (!(variant.chrom in chrom_lengths) || (variant.pos > chrom_lengths[variant.chrom])) {
            chrom_lengths[variant.chrom] = variant.pos;
        }
    });
    var chroms = _.sortBy(Object.keys(chrom_lengths), function(chrom) {
        return Number.parseFloat(chrom);
    });
    var chrom_offsets = {};
    chrom_offsets[chroms[0]] = 0;
    for (var i=1; i<chroms.length; i++) {
        chrom_offsets[chroms[i]] = chrom_offsets[chroms[i-1]] + chrom_lengths[chroms[i-1]] + chrom_padding;
    }
    return {
        "chrom_offsets": chrom_offsets,
        "chroms": chroms,
    };
});

function get_genomic_position(variant) {
    var chrom_offsets = get_chrom_offsets().chrom_offsets;
    return chrom_offsets[variant.chrom] + variant.pos;
}

function create_gwas_plot() {
    var svg_width = $('#plot_container').width();
    var svg_height = 550;

    var plot_margin = {
        'left': 70,
        'right': 30,
        'top': 10,
        'bottom': 170,
    };

    var plot_width = svg_width - plot_margin.left - plot_margin.right;
    var plot_height = svg_height - plot_margin.top - plot_margin.bottom;

    var x_scale = d3.scale.linear()
        .domain(d3.extent(window.variants, function(d) {
            return get_genomic_position(d);
        }))
        .range([0, plot_width]);

    var neglog10_min_pval = -Math.log10(d3.min(window.variants, function(d) {
        return d.pval;
    }));
    var y_scale = d3.scale.linear()
        .domain([neglog10_min_pval, 0])
        .range([0, plot_height]);

    // var color_by_chrom = d3.scale.category20()
    //     .domain(get_chrom_offsets().chroms);
    var color_by_chrom = d3.scale.ordinal()
        .domain(get_chrom_offsets().chroms)
        .range(['blue', 'yellow', 'red']);

    var gwas_svg = d3.select('#plot_container').append("svg")
        .attr('id', 'gwas_svg')
        .attr("width", svg_width)
        .attr("height", svg_height)
        .style("display", "block")
        .style("margin", "auto");
    var gwas_plot = gwas_svg.append("g")
        .attr('id', 'gwas_plot')
        .attr("transform", fmt("translate({0},{1})", plot_margin.left, plot_margin.top));

    // Significance Threshold line
    var significance_threshold = 5e-8;
    var significance_threshold_tooltip = d3.tip()
        .attr('class', 'd3-tip')
        .html(function(d) {
            return 'Significance Threshold: 5E-8';
        })
        .offset([-8,0]);
    gwas_svg.call(significance_threshold_tooltip);

    gwas_plot.append('line')
        .attr('x1', 0)
        .attr('x2', plot_width)
        .attr('y1', y_scale(-Math.log10(significance_threshold)))
        .attr('y2', y_scale(-Math.log10(significance_threshold)))
        .attr('stroke-width', '2px')
        .attr('stroke', 'gray')
        .attr('stroke-dasharray', '10,10')
        .on('mouseover', significance_threshold_tooltip.show)
        .on('mouseout', significance_threshold_tooltip.hide);

    // Points & labels
    var tooltip_template = _.template($('#tooltip-template').html());
    var point_tooltip = d3.tip()
        .attr('class', 'd3-tip')
        .html(function(d) {
            return tooltip_template({d: d});
        })
        .offset([-8,0]);
    gwas_svg.call(point_tooltip);

    var links = gwas_plot.selectAll('a.variant_point')
        .data(window.variants)
        .enter()
        .append('a')
        .attr('class', 'variant_point')
        .attr('xlink:href', function(d) {
            return fmt('/variant/{0}-{1}-{2}-{3}', d.chrom, d.pos, d.ref, d.alt);
        });
    links.append('circle')
        .attr('cx', function(d) {
            return x_scale(get_genomic_position(d));
        })
        .attr('cy', function(d) {
            return y_scale(-Math.log10(d.pval));
        })
        .attr('r', 5)
        .style('fill', function(d) {
            return color_by_chrom(d.chrom);
        })
        .style('fill-opacity', 0.5)
        .style('stroke-width', 1)
        .style('stroke', function(d) {
            return 'black';
        })
        .on('mouseover', function(d) {
            //Note: once a tooltip has been explicitly placed once, it must be explicitly placed forever after.
            point_tooltip.show(d, this);
        })
        .on('mouseout', point_tooltip.hide);


    // Axes
    var yAxis = d3.svg.axis()
        .scale(y_scale)
        .orient("left");
    gwas_plot.append("g")
        .attr("class", "y axis")
        .attr('transform', 'translate(-3,0)') // avoid letting points spill through the y axis.
        .call(yAxis);

    gwas_svg.append('text')
        .style('text-anchor', 'middle')
        .attr('transform', fmt('translate({0},{1})rotate(-90)',
                               plot_margin.left*.4,
                               plot_height/2 + plot_margin.top))
        .text('-log10(pvalue)');

    var xAxis = d3.svg.axis()
        .scale(x_scale)
        .orient("bottom");
    gwas_plot.append("g")
        .attr("class", "x axis")
        .attr("transform", fmt("translate(0,{0})", plot_height))
        .call(xAxis);

    gwas_svg.append('text')
        .style('text-anchor', 'middle')
        .attr('transform', fmt('translate({0},{1})',
                               plot_width/2 + plot_margin.left,
                               plot_height + plot_margin.top + plot_margin.bottom/3))
        .text('Genomic Position');
}

function fmt(format) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function(match, number) {
        return (typeof args[number] != 'undefined') ? args[number] : match;
    });
}