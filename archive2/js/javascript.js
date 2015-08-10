/**
 * Created by Vicky on 2/13/15.
 */

$(document).ready(function() {

    $('.nav').append("<a href='#introduction' class='panel'>HOME</a>")
        .append("<a href='#experiments' class='panel'>EXPERIMENTS</a>")
        .append("<a href='#resume' class='panel'>ABOUT</a>")
        .append("<a href='#blog' class='panel'>NETWORK</a>")
        .append("<a href='#contact' class='panel'>CONTACT</a>");
    $('#introduction').css("background-color", "#FFCC5C");
    $('#experiments').css("background-color","#96CEB4");
    $('#resume').css("background-color","#FF6F69");
    $('#blog').css("background-color","#F19C65");
    $('#contact').css("background-color", "#AAD8B0");

    $('a.panel').click(function() {

        $('a.panel').removeClass('selected');
        $(this).addClass('selected');
        $('#wrapper').scrollTo($(this).attr('href'), 1000);

        return false;

    });

    $(window).resize(function () {
        resizePanel();
    });




    function resizePanel() {
        width = $(window).width();
        height = $(window).height();

        mask_width = width * $('.item').length;
        $('#debug').html(width  + ' ' + height + ' ' + mask_width);

        $('#wrapper, .item').css({width: width, height: height});
        $('#mask').css({width: mask_width, height: height});
        $('#wrapper').scrollTo($('a.selected').attr('href'), 0);

    }

    function submit() {
        return "";
    }
});
